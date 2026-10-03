package com.jarvis.ai;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
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
import java.util.ArrayList;
import java.util.Locale;

@CapacitorPlugin(name = "MyJarvisSpeech")
public class MyJarvisSpeechPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    private boolean listening;

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
