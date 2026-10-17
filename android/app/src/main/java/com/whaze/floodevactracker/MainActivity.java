package com.whaze.floodevactracker;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(DevicePermissionsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
