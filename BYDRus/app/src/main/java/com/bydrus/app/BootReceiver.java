package com.bydrus.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;

/**
 * После перезагрузки мультимедиа некоторые прошивки сбрасывают включённые
 * службы специальных возможностей — возвращаем перевод экрана на место.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            if (!Prefs.sp(context).getBoolean(Prefs.TRANSLATOR_WANTED, false)) return;
            boolean secure = context.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS")
                    == PackageManager.PERMISSION_GRANTED;
            if (secure && !TranslatorService.isEnabledInSettings(context)) {
                TranslatorService.setEnabledInSettings(context, true);
            }
        } catch (Throwable ignored) {
        }
    }
}
