package com.jarvis.ai;

import android.Manifest;
import android.os.Bundle;
import android.content.pm.PackageManager;
import androidx.annotation.Nullable;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int AUDIO_PERMISSION = 5001;

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        registerPlugin(MyJarvisSpeechPlugin.class);
        super.onCreate(savedInstanceState);
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                    this,
                    new String[]{Manifest.permission.RECORD_AUDIO},
                    AUDIO_PERMISSION
            );
        }
    }
}
