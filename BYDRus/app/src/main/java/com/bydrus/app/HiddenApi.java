package com.bydrus.app;

import android.os.Build;

import java.lang.reflect.Method;

/**
 * Снимает ограничение на скрытые API (Android 9–10), чтобы можно было
 * вызвать системный метод смены языка. Если не получилось — не страшно,
 * дальше сработает обычная рефлексия или запасной путь через ADB.
 */
final class HiddenApi {
    private static boolean done;

    private HiddenApi() {}

    static synchronized void unseal() {
        if (done || Build.VERSION.SDK_INT < 28) return;
        done = true;
        try {
            Method forName = Class.class.getDeclaredMethod("forName", String.class);
            Method getDeclaredMethod = Class.class.getDeclaredMethod(
                    "getDeclaredMethod", String.class, Class[].class);
            Class<?> vmRuntime = (Class<?>) forName.invoke(null, "dalvik.system.VMRuntime");
            Method getRuntime = (Method) getDeclaredMethod.invoke(
                    vmRuntime, "getRuntime", (Object) null);
            Method setExemptions = (Method) getDeclaredMethod.invoke(
                    vmRuntime, "setHiddenApiExemptions", (Object) new Class[]{String[].class});
            Object runtime = getRuntime.invoke(null);
            setExemptions.invoke(runtime, (Object) new String[]{"L"});
        } catch (Throwable ignored) {
        }
    }
}
