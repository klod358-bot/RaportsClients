package com.bydrus.app;

import android.content.Context;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Словарь «китайский → русский».
 *
 * Источники (каждый следующий перекрывает предыдущий):
 *   assets/dict/common.txt      — общий словарь интерфейса BYD
 *   assets/dict/МОДЕЛЬ.txt      — добавки под конкретную модель (tang.txt и т. д.)
 *   .../files/user_dict.txt     — ваши собственные правки на самом устройстве
 *
 * Формат строки: китайский=русский (вместо «=» можно табуляцию). Строки с # — комментарии.
 *
 * Порядок перевода: точное совпадение фразы → фраза без хвостовой пунктуации →
 * пословная сборка из известных терминов (грубо, но понятно). Если хоть один иероглиф
 * неизвестен, надпись не трогаем и записываем её в untranslated.txt.
 */
final class Dictionary {
    static final String USER_FILE = "user_dict.txt";
    static final String UNTRANSLATED_FILE = "untranslated.txt";

    private static final String MISS = "\u0000";
    private static final int CACHE_LIMIT = 4000;
    private static final int LOG_LIMIT = 5000;

    private final Map<String, String> map = new HashMap<>();
    private final Map<String, String> cache = new HashMap<>();
    private final Set<String> logged = new HashSet<>();
    private final List<String> pendingLog = new ArrayList<>();
    private final File logFile;
    private int maxKeyLen = 1;
    private boolean wordByWord = true;
    private long lastFlush;

    private Dictionary(File logFile) {
        this.logFile = logFile;
    }

    static Dictionary load(Context ctx, String modelKey, boolean wordByWord) {
        File dir = ctx.getExternalFilesDir(null);
        if (dir == null) dir = ctx.getFilesDir();
        Dictionary d = new Dictionary(new File(dir, UNTRANSLATED_FILE));
        d.wordByWord = wordByWord;
        d.readAsset(ctx, "dict/common.txt");
        if (modelKey != null && modelKey.length() > 0) d.readAsset(ctx, "dict/" + modelKey + ".txt");

        File user = new File(dir, USER_FILE);
        if (!user.exists()) {
            try {
                Writer w = new OutputStreamWriter(new FileOutputStream(user), "UTF-8");
                w.write("# Ваш словарь. Формат: китайский=русский. Перекрывает встроенный.\n");
                w.write("# Непереведённые надписи приложение собирает в файл " + UNTRANSLATED_FILE + " рядом.\n");
                w.close();
            } catch (Throwable ignored) {
            }
        } else {
            try {
                d.read(new FileInputStream(user));
            } catch (Throwable ignored) {
            }
        }
        d.loadLogged();
        return d;
    }

    int size() {
        return map.size();
    }

    static boolean isCjk(char c) {
        return (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF);
    }

    static boolean hasCjk(CharSequence s) {
        for (int i = 0, n = s.length(); i < n; i++) if (isCjk(s.charAt(i))) return true;
        return false;
    }

    /** @return перевод или null, если переводить нечего или нечем. */
    String translate(String source, String pkg) {
        String cached = cache.get(source);
        if (cached != null) return cached == MISS ? null : cached;

        String result;
        if (source.indexOf('\n') >= 0) {
            StringBuilder sb = new StringBuilder();
            result = "";
            for (String line : source.split("\n")) {
                String t = line.trim();
                if (t.length() == 0) continue;
                String tr = hasCjk(t) ? translateLine(t) : t;
                if (tr == null) {
                    result = null;
                    break;
                }
                if (sb.length() > 0) sb.append(' ');
                sb.append(tr);
            }
            if (result != null) result = sb.toString();
        } else {
            result = translateLine(source.trim());
        }

        if (result == null) logUntranslated(pkg, source);
        if (cache.size() > CACHE_LIMIT) cache.clear();
        cache.put(source, result == null ? MISS : result);
        return result;
    }

    private String translateLine(String s) {
        String exact = map.get(s);
        if (exact != null && exact.length() > 0) return exact;

        // без хвостовой пунктуации: «温度：» → «Температура:»
        int end = s.length();
        while (end > 0 && isTail(s.charAt(end - 1))) end--;
        if (end > 0 && end < s.length()) {
            String core = map.get(s.substring(0, end));
            if (core != null && core.length() > 0) {
                return core + normalizePunct(s.substring(end)).trim();
            }
        }
        return wordByWord ? compose(s) : null;
    }

    private static boolean isTail(char c) {
        return c == ':' || c == '：' || c == '.' || c == '。' || c == '…' || c == ' '
                || c == '!' || c == '！' || c == '?' || c == '？';
    }

    /** Пословная сборка: жадно ищем самые длинные известные куски. */
    private String compose(String s) {
        StringBuilder out = new StringBuilder();
        int i = 0;
        int n = s.length();
        boolean first = true;
        while (i < n) {
            char c = s.charAt(i);
            if (isCjk(c)) {
                int max = Math.min(maxKeyLen, n - i);
                String tr = null;
                int used = 0;
                for (int len = max; len >= 1; len--) {
                    String t = map.get(s.substring(i, i + len));
                    if (t != null) {
                        tr = t;
                        used = len;
                        break;
                    }
                }
                if (tr == null) return null;
                if (tr.length() > 0) {
                    if (out.length() > 0) {
                        char last = out.charAt(out.length() - 1);
                        if (last != ' ' && last != '(' && last != '/' && last != '-' && last != '«') out.append(' ');
                    }
                    out.append(first ? tr : decapitalize(tr));
                    first = false;
                }
                i += used;
            } else {
                int j = i;
                while (j < n && !isCjk(s.charAt(j))) j++;
                String run = normalizePunct(s.substring(i, j));
                if (run.length() > 0) {
                    if (out.length() > 0 && Character.isLetterOrDigit(run.charAt(0))
                            && Character.isLetterOrDigit(out.charAt(out.length() - 1))) {
                        out.append(' ');
                    }
                    out.append(run);
                    if (run.trim().length() > 0) first = false;
                }
                i = j;
            }
        }
        String r = out.toString().replace("  ", " ").trim();
        if (r.length() == 0) return null;
        return Character.toUpperCase(r.charAt(0)) + r.substring(1);
    }

    private static String decapitalize(String s) {
        if (s.length() >= 2 && Character.isUpperCase(s.charAt(0)) && Character.isLowerCase(s.charAt(1))) {
            return Character.toLowerCase(s.charAt(0)) + s.substring(1);
        }
        return s;
    }

    private static String normalizePunct(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 4);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '：': sb.append(": "); break;
                case '，': sb.append(", "); break;
                case '、': sb.append(", "); break;
                case '。': sb.append(". "); break;
                case '；': sb.append("; "); break;
                case '！': sb.append("! "); break;
                case '？': sb.append("? "); break;
                case '（': sb.append(" ("); break;
                case '）': sb.append(") "); break;
                case '“': case '”': case '「': case '」': sb.append('"'); break;
                case '　': sb.append(' '); break;
                default: sb.append(c);
            }
        }
        return sb.toString();
    }

    // --------------------------------------------------------------- загрузка

    private void readAsset(Context ctx, String path) {
        try {
            InputStream in = ctx.getAssets().open(path);
            read(in);
        } catch (Throwable ignored) {
            // файла для модели может не быть — это нормально
        }
    }

    private void read(InputStream in) throws Exception {
        BufferedReader r = new BufferedReader(new InputStreamReader(in, "UTF-8"));
        String line;
        while ((line = r.readLine()) != null) {
            if (line.length() == 0 || line.charAt(0) == '#') continue;
            if (line.charAt(0) == '﻿') line = line.substring(1);
            int tab = line.indexOf('\t');
            if (tab < 0) tab = line.indexOf('=');
            if (tab <= 0) continue;
            String key = line.substring(0, tab).trim();
            String value = line.substring(tab + 1).trim();
            if (key.length() == 0) continue;
            map.put(key, value);
            if (key.length() > maxKeyLen) maxKeyLen = key.length();
        }
        r.close();
    }

    // ------------------------------------------------ сбор непереведённого

    private void loadLogged() {
        if (!logFile.exists()) return;
        try {
            BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(logFile), "UTF-8"));
            String line;
            while ((line = r.readLine()) != null && logged.size() < LOG_LIMIT) {
                int tab = line.indexOf('\t');
                if (tab >= 0) logged.add(line.substring(tab + 1));
            }
            r.close();
        } catch (Throwable ignored) {
        }
    }

    private void logUntranslated(String pkg, String source) {
        if (logged.size() >= LOG_LIMIT || source.length() > 80) return;
        String flat = source.replace('\n', ' ').replace('\t', ' ').trim();
        if (!logged.add(flat)) return;
        pendingLog.add((pkg == null ? "" : pkg) + "\t" + flat);
    }

    /** Сбрасывает накопленные непереведённые надписи на диск (не чаще раза в 10 секунд). */
    void flushLog(boolean force) {
        long now = System.currentTimeMillis();
        if (pendingLog.isEmpty() || (!force && now - lastFlush < 10000)) return;
        lastFlush = now;
        try {
            Writer w = new OutputStreamWriter(new FileOutputStream(logFile, true), "UTF-8");
            for (String s : pendingLog) w.write(s + "\n");
            w.close();
            pendingLog.clear();
        } catch (Throwable ignored) {
        }
    }
}
