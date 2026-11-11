package com.bydrus.app;

import android.app.backup.BackupManager;
import android.content.Context;
import android.content.res.Configuration;
import android.content.res.Resources;
import android.os.LocaleList;
import android.provider.Settings;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;

/**
 * Смена языка системы. Список «ru-RU,en-US» означает: русский там, где он есть,
 * иначе английский (а не китайский по умолчанию).
 */
final class LocaleSwitcher {
    static final String RUSSIAN = "ru-RU,en-US";
    static final String CHINESE = "zh-CN";

    private LocaleSwitcher() {}

    static String current() {
        return Resources.getSystem().getConfiguration().getLocales().toLanguageTags();
    }

    static boolean isRussian() {
        LocaleList l = Resources.getSystem().getConfiguration().getLocales();
        return !l.isEmpty() && "ru".equals(l.get(0).getLanguage());
    }

    /** @return null при успехе, иначе текст ошибки. */
    static String apply(Context ctx, String tags) {
        HiddenApi.unseal();
        try {
            LocaleList list = LocaleList.forLanguageTags(tags);
            if (list.isEmpty()) return "пустой список языков";

            Object am;
            try {
                am = Class.forName("android.app.ActivityManager").getMethod("getService").invoke(null);
            } catch (Throwable t) {
                am = Class.forName("android.app.ActivityManagerNative").getMethod("getDefault").invoke(null);
            }
            Class<?> iam = Class.forName("android.app.IActivityManager");
            Method getConf = iam.getMethod("getConfiguration");
            getConf.setAccessible(true);
            Configuration conf = (Configuration) getConf.invoke(am);
            conf.setLocales(list);
            try {
                Configuration.class.getField("userSetLocale").setBoolean(conf, true);
            } catch (Throwable ignored) {
            }

            String firstError = null;
            boolean ok = false;
            // Постоянная смена (переживает перезагрузку); требует ещё и WRITE_SETTINGS.
            try {
                Method m = iam.getMethod("updatePersistentConfiguration", Configuration.class);
                m.setAccessible(true);
                m.invoke(am, conf);
                ok = true;
            } catch (Throwable t) {
                firstError = describe(t);
            }
            if (!ok) {
                try {
                    Method m = iam.getMethod("updateConfiguration", Configuration.class);
                    m.setAccessible(true);
                    m.invoke(am, conf);
                    ok = true;
                } catch (Throwable t) {
                    return firstError + " / " + describe(t);
                }
            }
            // На случай, если прошивка читает язык из настроек при загрузке.
            try {
                Settings.System.putString(ctx.getContentResolver(), "system_locales", tags);
            } catch (Throwable ignored) {
            }
            try {
                BackupManager.dataChanged("com.android.providers.settings");
            } catch (Throwable ignored) {
            }
            return null;
        } catch (Throwable t) {
            return describe(t);
        }
    }

    private static String describe(Throwable t) {
        if (t instanceof InvocationTargetException && t.getCause() != null) t = t.getCause();
        String m = t.getMessage();
        return t.getClass().getSimpleName() + (m == null ? "" : ": " + m);
    }
}
