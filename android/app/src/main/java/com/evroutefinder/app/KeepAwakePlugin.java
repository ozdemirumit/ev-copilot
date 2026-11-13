package com.evroutefinder.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Yetenek işareti: varlığı, bu APK'nın ekranı ön planda yerel bayrakla açık tuttuğunu web tarafına bildirir.
 * status() yalnızca tanı içindir.
 */
@CapacitorPlugin(name = "EvrfKeepAwake")
public class KeepAwakePlugin extends Plugin {
    static volatile boolean foreground = false;

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("keepScreenOn", foreground);
        call.resolve(r);
    }
}
