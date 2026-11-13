package com.evroutefinder.app;

import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

/**
 * Ekranı açık tutma: uygulama ön plandayken (onResume..onPause) pencereye FLAG_KEEP_SCREEN_ON konur,
 * arka plana geçince kaldırılır. Bayrak pencereye bağlıdır; işletim sistemi (güç tuşu, ekran kilidi)
 * ekranı yine kapatabilir, uygulama bunu zorlamaz. PowerManager kilidi (arka planda uyanık tutma) kullanılmaz.
 * Web tarafı EvrfKeepAwake eklentisinin varlığından bunu anlar (js/sensors/wakeLock.js).
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KeepAwakePlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onResume() {
        super.onResume();
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        KeepAwakePlugin.foreground = true;
    }

    @Override
    public void onPause() {
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        KeepAwakePlugin.foreground = false;
        super.onPause();
    }
}
