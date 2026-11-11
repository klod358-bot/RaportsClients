package com.bydrus.app;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Определяет, на каком автомобиле запущено приложение: читает системные свойства
 * головного устройства и ищет в них название модели. Определение эвристическое —
 * если модель не найдена, её можно выбрать вручную, а файл диагностики покажет,
 * что именно сообщает прошивка.
 */
final class CarDetector {

    static final class Model {
        final String key;
        final String title;
        final String[] latin;
        final String[] cjk;

        Model(String key, String title, String[] latin, String[] cjk) {
            this.key = key;
            this.title = title;
            this.latin = latin;
            this.cjk = cjk;
        }
    }

    static final Model[] MODELS = {
            new Model("tang", "BYD Tang", new String[]{"tang"}, new String[]{"唐"}),
            new Model("han", "BYD Han", new String[]{"han"}, new String[]{"汉"}),
            new Model("song", "BYD Song", new String[]{"song", "sealion"}, new String[]{"宋", "海狮"}),
            new Model("qin", "BYD Qin", new String[]{"qin"}, new String[]{"秦"}),
            new Model("yuan", "BYD Yuan / Atto 3", new String[]{"yuan", "atto"}, new String[]{"元"}),
            new Model("seal", "BYD Seal", new String[]{"seal"}, new String[]{"海豹"}),
            new Model("dolphin", "BYD Dolphin", new String[]{"dolphin"}, new String[]{"海豚"}),
            new Model("seagull", "BYD Seagull", new String[]{"seagull"}, new String[]{"海鸥"}),
            new Model("destroyer", "BYD Destroyer 05", new String[]{"destroyer"}, new String[]{"驱逐舰"}),
            new Model("frigate", "BYD Frigate 07", new String[]{"frigate"}, new String[]{"护卫舰"}),
            new Model("denza", "Denza", new String[]{"denza"}, new String[]{"腾势"}),
    };

    static final class Info {
        boolean isByd;
        String modelKey = "";
        String modelTitle = "";
        String evidence = "";
        String dilink = "";
        String android = "";
        int width, height;
        Map<String, String> props = new LinkedHashMap<>();
        List<String> bydPackages = new ArrayList<>();
    }

    private static final String[] RELEVANT_KEYS = {
            "model", "product", "device", "name", "car", "vehicle", "board", "display.id",
            "flavor", "byd", "dilink", "hardware", "platform", "project", "series", "type"};

    private static final String SUFFIX = "(ev|dmi|dmp|dm|plus|pro|max|champion|[0-9]+|[lu])*";

    private CarDetector() {}

    static Model byKey(String key) {
        for (Model m : MODELS) if (m.key.equals(key)) return m;
        return null;
    }

    static Info detect(Context ctx) {
        Info info = new Info();
        info.android = Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")";

        Map<String, String> props = new LinkedHashMap<>();
        props.put("Build.MANUFACTURER", safe(Build.MANUFACTURER));
        props.put("Build.BRAND", safe(Build.BRAND));
        props.put("Build.MODEL", safe(Build.MODEL));
        props.put("Build.DEVICE", safe(Build.DEVICE));
        props.put("Build.PRODUCT", safe(Build.PRODUCT));
        props.put("Build.BOARD", safe(Build.BOARD));
        props.put("Build.HARDWARE", safe(Build.HARDWARE));
        props.put("Build.DISPLAY", safe(Build.DISPLAY));
        props.put("Build.FINGERPRINT", safe(Build.FINGERPRINT));
        props.putAll(readGetprop());
        info.props = props;

        try {
            WindowManager wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
            DisplayMetrics dm = new DisplayMetrics();
            wm.getDefaultDisplay().getRealMetrics(dm);
            info.width = dm.widthPixels;
            info.height = dm.heightPixels;
        } catch (Throwable ignored) {
        }

        try {
            List<PackageInfo> pkgs = ctx.getPackageManager().getInstalledPackages(0);
            for (PackageInfo p : pkgs) {
                if (p.packageName != null && p.packageName.toLowerCase(Locale.ROOT).contains("byd")) {
                    info.bydPackages.add(p.packageName);
                }
            }
            Collections.sort(info.bydPackages);
        } catch (Throwable ignored) {
        }

        // --- это BYD?
        boolean byd = !info.bydPackages.isEmpty();
        Pattern dilink = Pattern.compile("di\\s?link\\s?([0-9]+(\\.[0-9]+)?)?", Pattern.CASE_INSENSITIVE);
        for (Map.Entry<String, String> e : props.entrySet()) {
            String kv = (e.getKey() + "=" + e.getValue()).toLowerCase(Locale.ROOT);
            if (kv.contains("byd") || kv.contains("比亚迪")) byd = true;
            Matcher m = dilink.matcher(e.getValue());
            if (m.find()) {
                byd = true;
                if (info.dilink.length() == 0) info.dilink = m.group().trim();
            }
        }
        info.isByd = byd;

        // --- модель
        int bestScore = 0;
        for (Model model : MODELS) {
            int score = 0;
            String evidence = "";
            for (Map.Entry<String, String> e : props.entrySet()) {
                String key = e.getKey().toLowerCase(Locale.ROOT);
                String value = e.getValue().toLowerCase(Locale.ROOT);
                if (value.length() == 0) continue;
                if (!isRelevant(key) && !value.contains("byd")) continue;
                if (matches(model, value)) {
                    int weight = (key.contains("model") || key.contains("car") || key.contains("vehicle")) ? 3 : 1;
                    score += weight;
                    if (evidence.length() == 0) evidence = e.getKey() + " = " + e.getValue();
                }
            }
            if (score > bestScore) {
                bestScore = score;
                info.modelKey = model.key;
                info.modelTitle = model.title;
                info.evidence = evidence;
            }
        }
        return info;
    }

    private static boolean isRelevant(String key) {
        if (key.startsWith("build.")) return true;
        for (String k : RELEVANT_KEYS) if (key.contains(k)) return true;
        return false;
    }

    private static boolean matches(Model model, String value) {
        for (String c : model.cjk) if (value.contains(c)) return true;
        String[] tokens = value.split("[^a-z0-9]+");
        for (String l : model.latin) {
            Pattern p = Pattern.compile("^" + l + SUFFIX + "$");
            for (String t : tokens) {
                if (t.length() > 0 && p.matcher(t).matches()) return true;
            }
        }
        return false;
    }

    private static Map<String, String> readGetprop() {
        Map<String, String> out = new LinkedHashMap<>();
        try {
            Process proc = Runtime.getRuntime().exec("getprop");
            BufferedReader r = new BufferedReader(new InputStreamReader(proc.getInputStream(), "UTF-8"));
            Pattern line = Pattern.compile("^\\[(.+?)]: \\[(.*)]$");
            String s;
            while ((s = r.readLine()) != null) {
                Matcher m = line.matcher(s.trim());
                if (m.matches()) out.put(m.group(1), m.group(2));
            }
            r.close();
            proc.destroy();
        } catch (Throwable ignored) {
        }
        return out;
    }

    private static String safe(String s) {
        return s == null ? "" : s;
    }

    /** Текстовый отчёт: его можно прислать разработчику, чтобы уточнить определение модели. */
    static String diagnostics(Context ctx, Info info) {
        StringBuilder sb = new StringBuilder();
        sb.append("BYD Русификатор — диагностика\n");
        sb.append("BYD: ").append(info.isByd).append('\n');
        sb.append("Модель: ").append(info.modelTitle.length() == 0 ? "не определена" : info.modelTitle).append('\n');
        sb.append("Основание: ").append(info.evidence).append('\n');
        sb.append("DiLink: ").append(info.dilink).append('\n');
        sb.append("Android: ").append(info.android).append('\n');
        sb.append("Экран: ").append(info.width).append('x').append(info.height).append('\n');
        sb.append("Язык: ").append(LocaleSwitcher.current()).append('\n');
        sb.append("\n[Пакеты BYD]\n");
        for (String p : info.bydPackages) sb.append(p).append('\n');
        sb.append("\n[Свойства системы]\n");
        for (Map.Entry<String, String> e : info.props.entrySet()) {
            sb.append(e.getKey()).append(" = ").append(e.getValue()).append('\n');
        }
        return sb.toString();
    }
}
