package com.jarvis.ai;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Bundle;
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
                    String command = heard.substring(index + wakeWord.length()).trim();
                    JSObject o = new JSObject();
                    o.put("text", command);
                    o.put("wakeWord", wakeWord);
                    notifyListeners("wake", o);
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
        main.post(() -> { stopRecognizer(); call.resolve(); });
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
            if (tts != null) { try { tts.stop(); tts.shutdown(); } catch (Throwable ignored) {} tts = null; }
        });
        super.handleOnDestroy();
    }
}
