package com.bydrus.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;

/** Единственный экран: одна большая кнопка «сделать всё» и состояние по шагам. */
public class MainActivity extends Activity {

    private static final String P_SECURE = "android.permission.WRITE_SECURE_SETTINGS";
    private static final String P_CONFIG = "android.permission.CHANGE_CONFIGURATION";

    private TextView carView;
    private TextView statusView;
    private TextView logView;
    private Button mainButton;
    private Button styleButton;
    private Button wordsButton;
    private final StringBuilder log = new StringBuilder();
    private volatile CarDetector.Info info;
    private volatile boolean busy;

    // ---------------------------------------------------------------------- UI

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        int pad = dp(20);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        TextView title = text("BYD Русификатор", 26, true);
        root.addView(title);

        carView = text("Определяю автомобиль…", 18, false);
        carView.setPadding(0, dp(8), 0, dp(8));
        root.addView(carView);

        mainButton = button("РУСИФИЦИРОВАТЬ АВТОМАТИЧЕСКИ", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                runAuto();
            }
        });
        mainButton.setTextSize(20);
        mainButton.setMinimumHeight(dp(72));
        root.addView(mainButton, matchWidth());

        statusView = text("", 16, false);
        statusView.setPadding(0, dp(12), 0, dp(12));
        root.addView(statusView);

        LinearLayout row1 = row();
        row1.addView(button("Выбрать модель", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                chooseModel();
            }
        }), cell());
        styleButton = button("", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                SharedPreferences p = Prefs.sp(MainActivity.this);
                p.edit().putInt(Prefs.STYLE, (p.getInt(Prefs.STYLE, 0) + 1) % 3).apply();
                applyToService();
            }
        });
        row1.addView(styleButton, cell());
        wordsButton = button("", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                SharedPreferences p = Prefs.sp(MainActivity.this);
                p.edit().putBoolean(Prefs.WORD_BY_WORD, !p.getBoolean(Prefs.WORD_BY_WORD, true)).apply();
                applyToService();
            }
        });
        row1.addView(wordsButton, cell());
        root.addView(row1, matchWidth());

        LinearLayout row2 = row();
        row2.addView(button("Спец. возможности", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openAccessibilitySettings();
            }
        }), cell());
        row2.addView(button("Сохранить диагностику", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                saveDiagnostics();
            }
        }), cell());
        row2.addView(button("Вернуть как было", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                confirmRevert();
            }
        }), cell());
        root.addView(row2, matchWidth());

        logView = text("", 14, false);
        logView.setTypeface(Typeface.MONOSPACE);
        logView.setPadding(0, dp(16), 0, 0);
        logView.setTextIsSelectable(true);
        root.addView(logView);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);
        setContentView(scroll);

        new Thread(new Runnable() {
            @Override
            public void run() {
                detect();
            }
        }).start();
    }

    @Override
    protected void onResume() {
        super.onResume();
        refresh();
    }

    private TextView text(String s, int sp, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private Button button(String s, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(s);
        b.setAllCaps(false);
        b.setTextSize(16);
        b.setMinimumHeight(dp(56));
        b.setOnClickListener(l);
        return b;
    }

    private LinearLayout row() {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        return r;
    }

    private LinearLayout.LayoutParams cell() {
        return new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    }

    private LinearLayout.LayoutParams matchWidth() {
        return new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }

    // ------------------------------------------------------------- состояние

    private boolean has(String permission) {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private void detect() {
        CarDetector.Info i = CarDetector.detect(this);
        info = i;
        Prefs.sp(this).edit().putString(Prefs.MODEL_DETECTED, i.modelKey).apply();
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                refresh();
            }
        });
    }

    private void refresh() {
        CarDetector.Info i = info;
        SharedPreferences p = Prefs.sp(this);
        if (i != null) {
            StringBuilder sb = new StringBuilder();
            String manual = p.getString(Prefs.MODEL_OVERRIDE, "");
            CarDetector.Model m = CarDetector.byKey(manual);
            if (m != null) {
                sb.append("Автомобиль: ").append(m.title).append(" (выбрано вручную)");
            } else if (i.modelTitle.length() > 0) {
                sb.append("Автомобиль: ").append(i.modelTitle).append(" (определено автоматически)");
            } else if (i.isByd) {
                sb.append("Автомобиль: BYD, модель не определилась — выберите вручную");
            } else {
                sb.append("Это устройство не похоже на головное устройство BYD");
            }
            sb.append('\n');
            if (i.dilink.length() > 0) sb.append(i.dilink).append(" · ");
            sb.append("Android ").append(i.android).append(" · экран ").append(i.width).append('×').append(i.height);
            carView.setText(sb.toString());
        }

        TranslatorService svc = TranslatorService.instance;
        StringBuilder st = new StringBuilder();
        st.append(mark(LocaleSwitcher.isRussian())).append(" Язык системы: ").append(LocaleSwitcher.current()).append('\n');
        if (svc != null) {
            st.append(mark(true)).append(" Перевод экрана работает, фраз в словаре: ").append(svc.dictionarySize()).append('\n');
        } else if (TranslatorService.isEnabledInSettings(this)) {
            st.append("… Перевод экрана включён, служба запускается\n");
        } else {
            st.append(mark(false)).append(" Перевод экрана выключен\n");
        }
        st.append(mark(has(P_SECURE))).append(" Право на автонастройку (WRITE_SECURE_SETTINGS)\n");
        st.append(mark(has(P_CONFIG))).append(" Право на смену языка (CHANGE_CONFIGURATION)");
        statusView.setText(st.toString());

        String[] styles = {"Фон подписей: авто", "Фон подписей: тёмный", "Фон подписей: светлый"};
        styleButton.setText(styles[p.getInt(Prefs.STYLE, 0) % 3]);
        wordsButton.setText(p.getBoolean(Prefs.WORD_BY_WORD, true)
                ? "Пословный перевод: вкл" : "Пословный перевод: выкл");
        mainButton.setEnabled(!busy);
    }

    private static String mark(boolean ok) {
        return ok ? "✔" : "✖";
    }

    private void applyToService() {
        TranslatorService svc = TranslatorService.instance;
        if (svc != null) svc.reload();
        refresh();
    }

    private void say(final String message) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                log.append(message).append('\n');
                logView.setText(log.toString());
            }
        });
    }

    // -------------------------------------------------------- автонастройка

    private void runAuto() {
        if (busy) return;
        busy = true;
        log.setLength(0);
        refresh();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    doAuto();
                } catch (Throwable t) {
                    say("Ошибка: " + t);
                } finally {
                    busy = false;
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            refresh();
                        }
                    });
                }
            }
        }).start();
    }

    private void doAuto() {
        final String pkg = getPackageName();
        SharedPreferences p = Prefs.sp(this);

        say("1/4. Определяю автомобиль…");
        detect();
        CarDetector.Info i = info;
        if (i.modelTitle.length() > 0) {
            say("   " + i.modelTitle + "  [" + i.evidence + "]");
        } else if (i.isByd) {
            say("   BYD, модель по свойствам системы не определилась. Работаю с общим словарём; "
                    + "модель можно выбрать кнопкой «Выбрать модель».");
        } else {
            say("   Не похоже на BYD. Продолжаю как на обычном Android.");
        }

        say("2/4. Права доступа…");
        AdbClient adb = null;
        if (!has(P_SECURE) || !has(P_CONFIG)) {
            say("   Подключаюсь к ADB автомобиля (127.0.0.1:5555)…");
            try {
                adb = new AdbClient(this);
                adb.connect("127.0.0.1", 5555, new AdbClient.Say() {
                    @Override
                    public void say(String message) {
                        MainActivity.this.say("   " + message);
                    }
                });
                sayOut(adb.shell("pm grant " + pkg + " " + P_SECURE));
                sayOut(adb.shell("pm grant " + pkg + " " + P_CONFIG));
                sayOut(adb.shell("appops set " + pkg + " WRITE_SETTINGS allow"));
                adb.shell("dumpsys deviceidle whitelist +" + pkg);
                say("   Права выданы через ADB.");
            } catch (Throwable t) {
                say("   ADB недоступен: " + (t.getMessage() == null ? t.toString() : t.getMessage()));
                if (adb != null) adb.close();
                adb = null;
            }
        } else {
            say("   Все права уже есть.");
        }
        boolean secure = has(P_SECURE);
        boolean config = has(P_CONFIG);

        say("3/4. Перевод экрана…");
        p.edit().putBoolean(Prefs.TRANSLATOR_WANTED, true).apply();
        boolean needManual = false;
        if (TranslatorService.instance != null) {
            TranslatorService.instance.reload();
            say("   Уже работает.");
        } else if (secure && TranslatorService.setEnabledInSettings(this, true)) {
            say("   Служба перевода включена.");
        } else {
            needManual = true;
            say("   Включите вручную: «Спец. возможности» → «BYD Русификатор — перевод экрана».");
        }

        say("4/4. Язык системы…");
        if (LocaleSwitcher.isRussian()) {
            say("   Уже русский.");
        } else {
            if (p.getString(Prefs.ORIG_LOCALES, null) == null) {
                p.edit().putString(Prefs.ORIG_LOCALES, LocaleSwitcher.current()).apply();
            }
            String error = config ? LocaleSwitcher.apply(this, LocaleSwitcher.RUSSIAN) : "нет права CHANGE_CONFIGURATION";
            if (error == null) {
                say("   Язык переключён: русский, запасной — английский.");
            } else if (adb != null) {
                try {
                    sayOut(adb.shell("settings put system system_locales " + LocaleSwitcher.RUSSIAN));
                    say("   Язык записан в настройки; вступит в силу после перезагрузки мультимедиа.");
                } catch (Throwable t) {
                    say("   Не удалось сменить язык: " + error);
                }
            } else {
                say("   Язык не сменён (" + error + ").");
            }
        }
        if (adb != null) adb.close();

        if (!secure || !config) {
            say("");
            say("Чтобы приложение могло всё делать само, один раз выдайте права с компьютера:");
            say("  adb shell pm grant " + pkg + " " + P_SECURE);
            say("  adb shell pm grant " + pkg + " " + P_CONFIG);
            say("  adb shell appops set " + pkg + " WRITE_SETTINGS allow");
            say("и нажмите кнопку ещё раз.");
        } else {
            say("");
            say("Готово.");
        }
        if (needManual) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    openAccessibilitySettings();
                }
            });
        }
    }

    private void sayOut(String output) {
        if (output != null && output.length() > 0) say("   " + output);
    }

    // ----------------------------------------------------------- прочие кнопки

    private void openAccessibilitySettings() {
        try {
            startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
        } catch (Throwable t) {
            Toast.makeText(this, "В этой прошивке нет экрана спец. возможностей — нужны права через ADB",
                    Toast.LENGTH_LONG).show();
        }
    }

    private void chooseModel() {
        final String[] titles = new String[CarDetector.MODELS.length + 1];
        titles[0] = "Определять автоматически";
        for (int k = 0; k < CarDetector.MODELS.length; k++) titles[k + 1] = CarDetector.MODELS[k].title;
        new AlertDialog.Builder(this)
                .setTitle("Модель автомобиля")
                .setItems(titles, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        String key = which == 0 ? "" : CarDetector.MODELS[which - 1].key;
                        Prefs.sp(MainActivity.this).edit().putString(Prefs.MODEL_OVERRIDE, key).apply();
                        applyToService();
                    }
                })
                .show();
    }

    private void saveDiagnostics() {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    CarDetector.Info i = CarDetector.detect(MainActivity.this);
                    File dir = getExternalFilesDir(null);
                    if (dir == null) dir = getFilesDir();
                    File f = new File(dir, "diagnostics.txt");
                    Writer w = new OutputStreamWriter(new FileOutputStream(f), "UTF-8");
                    w.write(CarDetector.diagnostics(MainActivity.this, i));
                    w.close();
                    say("Диагностика сохранена: " + f.getAbsolutePath());
                    say("Рядом лежат " + Dictionary.UNTRANSLATED_FILE + " (что не перевелось) и "
                            + Dictionary.USER_FILE + " (ваш словарь).");
                } catch (Throwable t) {
                    say("Не удалось сохранить диагностику: " + t);
                }
            }
        }).start();
    }

    private void confirmRevert() {
        new AlertDialog.Builder(this)
                .setTitle("Вернуть как было?")
                .setMessage("Язык системы вернётся к исходному, перевод экрана выключится.")
                .setPositiveButton("Вернуть", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        revert();
                    }
                })
                .setNegativeButton("Отмена", null)
                .show();
    }

    private void revert() {
        SharedPreferences p = Prefs.sp(this);
        p.edit().putBoolean(Prefs.TRANSLATOR_WANTED, false).apply();
        log.setLength(0);

        TranslatorService svc = TranslatorService.instance;
        if (has(P_SECURE)) {
            TranslatorService.setEnabledInSettings(this, false);
            say("Перевод экрана выключен.");
        } else if (svc != null) {
            svc.disableSelf();
            say("Перевод экрана выключен.");
        }

        String orig = p.getString(Prefs.ORIG_LOCALES, null);
        if (orig == null || orig.length() == 0) orig = LocaleSwitcher.CHINESE;
        if (LocaleSwitcher.isRussian()) {
            String error = has(P_CONFIG) ? LocaleSwitcher.apply(this, orig) : "нет права CHANGE_CONFIGURATION";
            say(error == null ? "Язык системы возвращён: " + orig : "Язык не возвращён (" + error + ").");
        }
        p.edit().remove(Prefs.ORIG_LOCALES).apply();
        refresh();
    }
}
