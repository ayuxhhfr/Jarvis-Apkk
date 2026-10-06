package com.jarvis.ai;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Bundle;
import android.util.Base64;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.PermissionState;
import java.util.ArrayList;
import java.util.Locale;

@CapacitorPlugin(
        name = "MyJarvisSpeech",
        permissions = {
                @Permission(
                        alias = "microphone",
                        strings = { Manifest.permission.RECORD_AUDIO }
                )
        }
)
public class MyJarvisSpeechPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    private boolean listening;
    private boolean wakeWordActive;

    // Native realtime PCM capture for Android. Using AudioRecord with the
    // voice-communication audio path lets Android's hardware/audio stack apply
    // AEC/NS/AGC before the 16 kHz PCM reaches the WebView/Gemini Live.
    private AudioRecord pcmRecorder;
    private Thread pcmThread;
    private volatile boolean pcmCaptureActive;
    private String wakeWord = "jarvis";

    @Override
    public void load() {
        super.load();
        main.post(() -> tts = new TextToSpeech(getContext(), status -> {
            if (tts != null && status == TextToSpeech.SUCCESS) {
                tts.setLanguage(Locale.US);
                tts.setSpeechRate(0.96f);
            }
        }));
    }

    @PluginMethod
    public void requestMicrophonePermission(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }

        requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
    }

    @com.getcapacitor.annotation.PermissionCallback
    private void microphonePermissionCallback(PluginCall call) {
        boolean granted = getPermissionState("microphone") == PermissionState.GRANTED;
        JSObject result = new JSObject();
        result.put("granted", granted);
        if (granted) {
            call.resolve(result);
        } else {
            call.reject("Microphone permission denied");
        }
    }


    @PluginMethod
    public void openApp(PluginCall call) {
        String query = call.getString("query", "").trim();
        String packageName = call.getString("packageName", "").trim();
        main.post(() -> {
            try {
                PackageManager pm = getContext().getPackageManager();
                Intent launch = null;
                if (!packageName.isEmpty()) launch = pm.getLaunchIntentForPackage(packageName);
                if (launch == null && !query.isEmpty()) {
                    Intent launcher = new Intent(Intent.ACTION_MAIN, null);
                    launcher.addCategory(Intent.CATEGORY_LAUNCHER);
                    for (ResolveInfo info : pm.queryIntentActivities(launcher, PackageManager.MATCH_ALL)) {
                        String label = String.valueOf(info.loadLabel(pm));
                        String pkg = info.activityInfo.packageName;
                        if (label.equalsIgnoreCase(query) || pkg.equalsIgnoreCase(query) ||
                            label.toLowerCase(Locale.ROOT).contains(query.toLowerCase(Locale.ROOT))) {
                            launch = pm.getLaunchIntentForPackage(pkg);
                            if (launch != null) break;
                        }
                    }
                }
                if (launch == null) {
                    call.reject("App not found: " + (query.isEmpty() ? packageName : query));
                    return;
                }
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
                getContext().startActivity(launch);
                JSObject result = new JSObject();
                result.put("opened", true);
                result.put("packageName", launch.getComponent() == null ? "" : launch.getComponent().getPackageName());
                call.resolve(result);
            } catch (Throwable e) {
                call.reject(e.getMessage() == null ? "Unable to open app" : e.getMessage());
            }
        });
    }

    @PluginMethod
    public void listApps(PluginCall call) {
        main.post(() -> {
            try {
                PackageManager pm = getContext().getPackageManager();
                Intent launcher = new Intent(Intent.ACTION_MAIN, null);
                launcher.addCategory(Intent.CATEGORY_LAUNCHER);
                ArrayList<ResolveInfo> infos = pm.queryIntentActivities(launcher, PackageManager.MATCH_ALL);
                org.json.JSONArray apps = new org.json.JSONArray();
                java.util.HashSet<String> seen = new java.util.HashSet<>();
                for (ResolveInfo info : infos) {
                    String pkg = info.activityInfo.packageName;
                    if (!seen.add(pkg)) continue;
                    org.json.JSONObject app = new org.json.JSONObject();
                    app.put("name", String.valueOf(info.loadLabel(pm)));
                    app.put("packageName", pkg);
                    apps.put(app);
                }
                JSObject result = new JSObject();
                result.put("apps", apps);
                call.resolve(result);
            } catch (Throwable e) {
                call.reject(e.getMessage() == null ? "Unable to list apps" : e.getMessage());
            }
        });
    }

    @PluginMethod
    public void startWakeWord(PluginCall call) {
        wakeWordActive = true;
        wakeWord = call.getString("wakeWord", "jarvis").trim().toLowerCase(Locale.ROOT);
        main.post(() -> {
            startWakeRecognizer();
            call.resolve();
        });
    }

    @PluginMethod
    public void stopWakeWord(PluginCall call) {
        wakeWordActive = false;
        main.post(() -> { stopRecognizer(); call.resolve(); });
    }

    private void startWakeRecognizer() {
        if (!wakeWordActive) return;
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            notifyWakeError("Microphone permission is not granted");
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            notifyWakeError("Android speech recognition is unavailable");
            return;
        }
        stopRecognizer();
        recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
        recognizer.setRecognitionListener(new RecognitionListener() {
            public void onReadyForSpeech(Bundle p) { emitState("wake_listening"); }
            public void onBeginningOfSpeech() { emitState("wake_hearing"); }
            public void onRmsChanged(float r) {}
            public void onBufferReceived(byte[] b) {}
            public void onEndOfSpeech() { emitState("wake_processing"); }
            public void onError(int e) {
                if (wakeWordActive) main.postDelayed(() -> startWakeRecognizer(), 350);
            }
            public void onResults(Bundle results) {
                String heard = "";
                ArrayList<String> m = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (m != null && !m.isEmpty()) heard = m.get(0).trim();
                String lower = heard.toLowerCase(Locale.ROOT);
                int index = lower.indexOf(wakeWord);
                if (index >= 0) {
                    // Pause the wake recognizer before handing the utterance to the
                    // command pipeline. This prevents SpeechRecognizer instances
                    // from fighting over the microphone during the command turn.
                    wakeWordActive = false;
                    stopRecognizer();
                    String command = heard.substring(index + wakeWord.length()).trim();
                    JSObject o = new JSObject();
                    o.put("text", command);
                    o.put("wakeWord", wakeWord);
                    notifyListeners("wake", o);
                    return;
                }
                if (wakeWordActive) main.postDelayed(() -> startWakeRecognizer(), 250);
            }
            public void onPartialResults(Bundle results) {}
            public void onEvent(int t, Bundle p) {}
        });
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN");
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        try { recognizer.startListening(i); } catch (Throwable e) {
            if (wakeWordActive) main.postDelayed(() -> startWakeRecognizer(), 700);
        }
    }

    private void notifyWakeError(String message) {
        JSObject o = new JSObject();
        o.put("message", message);
        notifyListeners("wakeError", o);
    }

    @PluginMethod
    public void startPcmCapture(PluginCall call) {
        main.post(() -> {
            try {
                if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
                        != PackageManager.PERMISSION_GRANTED) {
                    call.reject("Microphone permission is not granted");
                    return;
                }

                stopPcmCaptureInternal();

                final int sampleRate = 16000;
                final int chunkSamples = 640; // 40 ms at 16 kHz
                final int channelMask = AudioFormat.CHANNEL_IN_MONO;
                final int encoding = AudioFormat.ENCODING_PCM_16BIT;

                int minBuffer = AudioRecord.getMinBufferSize(sampleRate, channelMask, encoding);
                if (minBuffer <= 0) {
                    call.reject("Android audio input is unavailable");
                    return;
                }

                int bufferBytes = Math.max(minBuffer * 2, chunkSamples * 2 * 4);
                AudioRecord.Builder builder = new AudioRecord.Builder()
                        .setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
                        .setAudioFormat(new AudioFormat.Builder()
                                .setSampleRate(sampleRate)
                                .setChannelMask(channelMask)
                                .setEncoding(encoding)
                                .build())
                        .setBufferSizeInBytes(bufferBytes);

                if (android.os.Build.VERSION.SDK_INT >= 29) {
                    try { builder.setPrivacySensitive(true); } catch (Throwable ignored) {}
                }

                AudioRecord record;
                try {
                    record = builder.build();
                } catch (Throwable primaryError) {
                    // A few vendor devices reject VOICE_COMMUNICATION at 16 kHz.
                    // Fall back to VOICE_RECOGNITION, which still enables the
                    // platform's speech-oriented processing path where available.
                    builder = new AudioRecord.Builder()
                            .setAudioSource(MediaRecorder.AudioSource.UNPROCESSED)
                            .setAudioFormat(new AudioFormat.Builder()
                                    .setSampleRate(sampleRate)
                                    .setChannelMask(channelMask)
                                    .setEncoding(encoding)
                                    .build())
                            .setBufferSizeInBytes(bufferBytes);
                    if (android.os.Build.VERSION.SDK_INT >= 29) {
                        try { builder.setPrivacySensitive(true); } catch (Throwable ignored) {}
                    }
                    record = builder.build();
                }

                if (record.getState() != AudioRecord.STATE_INITIALIZED) {
                    try { record.release(); } catch (Throwable ignored) {}
                    call.reject("Android microphone could not be initialized");
                    return;
                }

                pcmRecorder = record;
                final int sessionId = record.getAudioSessionId();

                // Do not stack explicit AEC/NS/AGC effects. The Android
                // speech-oriented input source handles the vendor voice path;
                // stacking effects here caused pumping/clipping on some phones.
                boolean aecEnabled = false;
                boolean nsEnabled = false;
                boolean agcEnabled = false;

                pcmCaptureActive = true;
                final boolean finalAecEnabled = aecEnabled;
                final boolean finalNsEnabled = nsEnabled;
                final boolean finalAgcEnabled = agcEnabled;

                JSObject ready = new JSObject();
                ready.put("sampleRate", sampleRate);
                ready.put("chunkMs", 40);
                ready.put("echoCancellation", finalAecEnabled);
                ready.put("noiseSuppression", finalNsEnabled);
                ready.put("automaticGainControl", finalAgcEnabled);
                notifyListeners("audioReady", ready);

                pcmThread = new Thread(() -> {
                    short[] buffer = new short[chunkSamples];
                    float noiseFloor = 0.0045f;
                    int speechFrames = 0;
                    int silenceFrames = 0;
                    boolean speechActive = false;

                    try {
                        record.startRecording();

                        while (pcmCaptureActive && pcmRecorder == record) {
                            int read = record.read(buffer, 0, buffer.length, AudioRecord.READ_BLOCKING);
                            if (read <= 0) continue;

                            double sumSquares = 0.0;
                            for (int i = 0; i < read; i++) {
                                float v = buffer[i] / 32768.0f;
                                sumSquares += v * v;
                            }
                            float rms = (float) Math.sqrt(sumSquares / Math.max(1, read));

                            // Adaptive floor: only learn while we are not confidently
                            // hearing speech, so distant speech remains detectable.
                            float threshold = Math.max(0.009f, noiseFloor * 2.4f);
                            boolean speech = rms >= threshold;

                            if (!speech) {
                                noiseFloor = noiseFloor * 0.94f + rms * 0.06f;
                                silenceFrames++;
                                speechFrames = 0;
                            } else {
                                speechFrames++;
                                silenceFrames = 0;
                            }

                            if (!speechActive && speechFrames >= 3) {
                                speechActive = true;
                                JSObject event = new JSObject();
                                event.put("speech", true);
                                event.put("rms", rms);
                                event.put("threshold", threshold);
                                notifyListeners("speechActivity", event);
                            } else if (speechActive && silenceFrames >= 15) {
                                speechActive = false;
                                JSObject event = new JSObject();
                                event.put("speech", false);
                                event.put("rms", rms);
                                event.put("threshold", threshold);
                                notifyListeners("speechActivity", event);
                            }

                            byte[] bytes = new byte[read * 2];
                            for (int i = 0; i < read; i++) {
                                bytes[i * 2] = (byte) (buffer[i] & 0xff);
                                bytes[i * 2 + 1] = (byte) ((buffer[i] >> 8) & 0xff);
                            }

                            JSObject audio = new JSObject();
                            audio.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
                            audio.put("rms", rms);
                            audio.put("speech", speechActive);
                            notifyListeners("audioChunk", audio);
                        }
                    } catch (Throwable e) {
                        if (pcmCaptureActive) {
                            JSObject error = new JSObject();
                            error.put("message", e.getMessage() == null ? "Native audio capture failed" : e.getMessage());
                            notifyListeners("audioCaptureError", error);
                        }
                    } finally {
                        try { record.stop(); } catch (Throwable ignored) {}
                    }
                }, "JarvisNativeMic");

                try { android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO); } catch (Throwable ignored) {}
                pcmThread.start();
                call.resolve();
            } catch (Throwable e) {
                stopPcmCaptureInternal();
                call.reject(e.getMessage() == null ? "Unable to start native microphone" : e.getMessage());
            }
        });
    }

    @PluginMethod
    public void stopPcmCapture(PluginCall call) {
        main.post(() -> {
            stopPcmCaptureInternal();
            call.resolve();
        });
    }

    private void stopPcmCaptureInternal() {
        pcmCaptureActive = false;

        AudioRecord record = pcmRecorder;
        pcmRecorder = null;

        if (record != null) {
            try { record.stop(); } catch (Throwable ignored) {}
            try { record.release(); } catch (Throwable ignored) {}
        }

        Thread thread = pcmThread;
        pcmThread = null;
        if (thread != null && thread != Thread.currentThread()) {
            try { thread.interrupt(); } catch (Throwable ignored) {}
        }
    }

    @PluginMethod
    public void startListening(PluginCall call) {
        main.post(() -> {
            if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
                    != PackageManager.PERMISSION_GRANTED) {
                call.reject("Microphone permission is not granted");
                return;
            }
            if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
                call.reject("Android speech recognition is unavailable");
                return;
            }
            stopRecognizer();
            recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(new RecognitionListener() {
                public void onReadyForSpeech(Bundle p) { listening = true; emitState("ready"); }
                public void onBeginningOfSpeech() { emitState("speaking"); }
                public void onRmsChanged(float r) {}
                public void onBufferReceived(byte[] b) {}
                public void onEndOfSpeech() { emitState("processing"); }
                public void onError(int e) {
                    listening = false;
                    JSObject o = new JSObject();
                    o.put("code", e);
                    o.put("message", error(e));
                    notifyListeners("error", o);
                }
                public void onResults(Bundle results) {
                    listening = false;
                    ArrayList<String> m = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (m != null && !m.isEmpty()) {
                        JSObject o = new JSObject();
                        o.put("text", m.get(0));
                        notifyListeners("result", o);
                    }
                    emitState("ended");
                }
                public void onPartialResults(Bundle results) {
                    ArrayList<String> m = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (m != null && !m.isEmpty()) {
                        JSObject o = new JSObject();
                        o.put("text", m.get(0));
                        notifyListeners("partialResult", o);
                    }
                }
                public void onEvent(int t, Bundle p) {}
            });
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, call.getString("language", "en-IN"));
            i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
            try {
                recognizer.startListening(i);
                call.resolve();
            } catch (Throwable e) {
                stopRecognizer();
                call.reject(e.getMessage() == null ? "Unable to start microphone" : e.getMessage());
            }
        });
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        wakeWordActive = false;
        main.post(() -> { stopRecognizer(); stopPcmCaptureInternal(); call.resolve(); });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        main.post(() -> {
            if (tts == null) {
                call.reject("Android text-to-speech is unavailable");
                return;
            }
            try {
                tts.setLanguage(Locale.US);
                tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "JARVIS_TTS");
                call.resolve();
            } catch (Throwable e) {
                call.reject(e.getMessage() == null ? "Unable to speak" : e.getMessage());
            }
        });
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        main.post(() -> { if (tts != null) tts.stop(); call.resolve(); });
    }

    private void emitState(String state) {
        JSObject o = new JSObject();
        o.put("state", state);
        notifyListeners("state", o);
    }

    private String error(int e) {
        switch (e) {
            case SpeechRecognizer.ERROR_AUDIO: return "Audio recording error";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "Microphone permission denied";
            case SpeechRecognizer.ERROR_NETWORK: return "Speech recognition network error";
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "Speech recognition network timeout";
            case SpeechRecognizer.ERROR_NO_MATCH: return "No speech recognized";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "No speech detected";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "Speech recognizer is busy";
            default: return "Speech recognition error: " + e;
        }
    }

    private void stopRecognizer() {
        listening = false;
        if (recognizer != null) {
            try { recognizer.cancel(); } catch (Throwable ignored) {}
            try { recognizer.destroy(); } catch (Throwable ignored) {}
            recognizer = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        main.post(() -> {
            stopRecognizer();
            stopPcmCaptureInternal();
            if (tts != null) { try { tts.stop(); tts.shutdown(); } catch (Throwable ignored) {} tts = null; }
        });
        super.handleOnDestroy();
    }
}
