package com.bydrus.app;

import android.content.Context;
import android.content.SharedPreferences;

/** Настройки приложения. */
final class Prefs {
    static final String MODEL_OVERRIDE = "model_override";   // ключ модели, выбранной вручную ("" = авто)
    static final String MODEL_DETECTED = "model_detected";   // последняя автоматически определённая модель
    static final String ORIG_LOCALES = "orig_locales";       // язык системы до русификации
    static final String TRANSLATOR_WANTED = "translator_wanted";
    static final String WORD_BY_WORD = "word_by_word";       // пословный перевод неизвестных фраз
    static final String STYLE = "style";                     // 0 авто, 1 тёмный, 2 светлый
    static final String ADB_PRIV = "adb_priv";
    static final String ADB_PUB = "adb_pub";

    private Prefs() {}

    static SharedPreferences sp(Context c) {
        return c.getApplicationContext().getSharedPreferences("bydrus", Context.MODE_PRIVATE);
    }

    /** Модель, под которую грузится словарь: ручной выбор важнее автоопределения. */
    static String activeModel(Context c) {
        SharedPreferences p = sp(c);
        String manual = p.getString(MODEL_OVERRIDE, "");
        if (manual != null && manual.length() > 0) return manual;
        String auto = p.getString(MODEL_DETECTED, "");
        return auto == null ? "" : auto;
    }
}
