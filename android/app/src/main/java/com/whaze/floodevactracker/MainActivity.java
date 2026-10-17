package com.whaze.floodevactracker;

import android.os.Bundle;
import android.util.DisplayMetrics;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(DevicePermissionsPlugin.class);
        super.onCreate(savedInstanceState);

        final View rootView = getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(rootView, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            DisplayMetrics dm = getResources().getDisplayMetrics();
            float density = dm.density > 0 ? dm.density : 1f;
            int topCssPx = Math.max(28, Math.round(bars.top / density));
            int bottomCssPx = Math.max(0, Math.round(bars.bottom / density));

            if (getBridge() != null && getBridge().getWebView() != null) {
                final String js = "document.documentElement.classList.add('is-native-android');"
                    + "document.documentElement.style.setProperty('--android-cutout-top','" + topCssPx + "px');"
                    + "document.documentElement.style.setProperty('--android-nav-bottom','" + bottomCssPx + "px');";
                getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(js, null));
            }
            return ViewCompat.onApplyWindowInsets(v, windowInsets);
        });
    }
}
