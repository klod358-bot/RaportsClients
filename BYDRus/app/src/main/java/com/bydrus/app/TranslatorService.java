package com.bydrus.app;

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * Служба специальных возможностей: читает текст на экране, находит китайские надписи
 * и показывает поверх них русский перевод. Root не нужен.
 */
public class TranslatorService extends AccessibilityService {

    static volatile TranslatorService instance;

    private static final int MAX_NODES = 2500;
    private static final int MIN_INTERVAL_MS = 250;

    private WindowManager wm;
    private OverlayView overlay;
    private HandlerThread thread;
    private Handler bg;
    private Handler ui;
    private volatile Dictionary dict;
    private volatile boolean scheduled;
    private long lastScan;
    private String lastSignature = "";
    private int nodeCount;

    private final Runnable scanTask = new Runnable() {
        @Override
        public void run() {
            scheduled = false;
            try {
                scan();
            } catch (Throwable ignored) {
            }
        }
    };

    // ------------------------------------------------------------ жизненный цикл

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
        ui = new Handler(Looper.getMainLooper());
        thread = new HandlerThread("bydrus-scan");
        thread.start();
        bg = new Handler(thread.getLooper());

        wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        overlay = new OverlayView(this);
        overlay.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.LEFT;
        try {
            wm.addView(overlay, lp);
        } catch (Throwable t) {
            overlay = null;
        }
        reload();
    }

    /** Перечитать словарь и настройки (после смены модели, стиля и т. п.). */
    void reload() {
        if (bg == null) return;
        bg.post(new Runnable() {
            @Override
            public void run() {
                final SharedPreferences p = Prefs.sp(TranslatorService.this);
                Dictionary old = dict;
                if (old != null) old.flushLog(true);
                dict = Dictionary.load(TranslatorService.this,
                        Prefs.activeModel(TranslatorService.this),
                        p.getBoolean(Prefs.WORD_BY_WORD, true));
                lastSignature = "";
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        if (overlay != null) overlay.setStyle(p.getInt(Prefs.STYLE, 0));
                    }
                });
                schedule(0, false);
            }
        });
    }

    int dictionarySize() {
        Dictionary d = dict;
        return d == null ? 0 : d.size();
    }

    @Override
    public void onInterrupt() {
    }

    @Override
    public boolean onUnbind(android.content.Intent intent) {
        shutdown();
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        shutdown();
        super.onDestroy();
    }

    private void shutdown() {
        if (instance == this) instance = null;
        Dictionary d = dict;
        if (d != null) d.flushLog(true);
        if (overlay != null && wm != null) {
            try {
                wm.removeView(overlay);
            } catch (Throwable ignored) {
            }
            overlay = null;
        }
        if (thread != null) {
            thread.quitSafely();
            thread = null;
        }
    }

    // ------------------------------------------------------------------ события

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (dict == null || overlay == null || event == null) return;
        CharSequence pkg = event.getPackageName();
        if (pkg != null && getPackageName().contentEquals(pkg)) return;

        switch (event.getEventType()) {
            case AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED:
            case AccessibilityEvent.TYPE_WINDOWS_CHANGED:
                // сменилось окно — старые подписи сразу убираем
                hideNow();
                schedule(150, true);
                break;
            case AccessibilityEvent.TYPE_VIEW_SCROLLED:
                // во время прокрутки подписи не показываем, чтобы не «плавали»
                hideNow();
                schedule(280, true);
                break;
            default:
                schedule(200, false);
        }
    }

    private void hideNow() {
        lastSignature = "";
        ui.post(new Runnable() {
            @Override
            public void run() {
                if (overlay != null) overlay.clear();
            }
        });
    }

    /** @param restart true — отложить уже запланированное сканирование (ждём, пока экран успокоится) */
    private void schedule(long delay, boolean restart) {
        Handler h = bg;
        if (h == null) return;
        if (scheduled && !restart) return;
        long wait = Math.max(delay, lastScan + MIN_INTERVAL_MS - System.currentTimeMillis());
        scheduled = true;
        h.removeCallbacks(scanTask);
        h.postDelayed(scanTask, Math.max(0, wait));
    }

    // ------------------------------------------------------------- сканирование

    private void scan() {
        lastScan = System.currentTimeMillis();
        Dictionary d = dict;
        if (d == null) return;

        final List<OverlayView.Label> out = new ArrayList<>();
        List<Rect> upper = new ArrayList<>();
        nodeCount = 0;

        List<AccessibilityWindowInfo> windows = null;
        try {
            windows = getWindows();
        } catch (Throwable ignored) {
        }
        if (windows != null && !windows.isEmpty()) {
            windows = new ArrayList<>(windows);
            Collections.sort(windows, new Comparator<AccessibilityWindowInfo>() {
                @Override
                public int compare(AccessibilityWindowInfo a, AccessibilityWindowInfo b) {
                    return b.getLayer() - a.getLayer();   // сверху вниз
                }
            });
            for (AccessibilityWindowInfo w : windows) {
                int type = w.getType();
                if (type == AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY) continue;
                Rect bounds = new Rect();
                w.getBoundsInScreen(bounds);
                if (type != AccessibilityWindowInfo.TYPE_INPUT_METHOD) {
                    AccessibilityNodeInfo root = null;
                    try {
                        root = w.getRoot();
                    } catch (Throwable ignored) {
                    }
                    if (root != null) {
                        collect(root, d, out, upper);
                        root.recycle();
                    }
                }
                upper.add(bounds);
            }
        } else {
            AccessibilityNodeInfo root = getRootInActiveWindow();
            if (root != null) {
                collect(root, d, out, upper);
                root.recycle();
            }
        }
        d.flushLog(false);

        StringBuilder sig = new StringBuilder();
        for (OverlayView.Label l : out) {
            sig.append(l.rect.left).append(',').append(l.rect.top).append(',')
                    .append(l.rect.right).append(',').append(l.rect.bottom).append(l.text).append('|');
        }
        String signature = sig.toString();
        if (signature.equals(lastSignature)) return;
        lastSignature = signature;
        ui.post(new Runnable() {
            @Override
            public void run() {
                if (overlay != null) overlay.setLabels(out);
            }
        });
    }

    private void collect(AccessibilityNodeInfo node, Dictionary d,
                         List<OverlayView.Label> out, List<Rect> upper) {
        if (node == null || nodeCount++ > MAX_NODES) return;
        if (!node.isVisibleToUser()) return;
        CharSequence pkg = node.getPackageName();
        if (pkg != null && getPackageName().contentEquals(pkg)) return;

        CharSequence text = node.getText();
        if (text != null && text.length() > 0 && text.length() <= 160 && !node.isEditable()) {
            String s = text.toString();
            if (Dictionary.hasCjk(s)) {
                String tr = d.translate(s, pkg == null ? null : pkg.toString());
                if (tr != null) {
                    Rect r = new Rect();
                    node.getBoundsInScreen(r);
                    if (r.width() >= 12 && r.height() >= 12 && !covered(r, upper)) {
                        out.add(new OverlayView.Label(r, tr, s.length()));
                    }
                }
            }
        }
        int n = node.getChildCount();
        for (int i = 0; i < n; i++) {
            AccessibilityNodeInfo child = null;
            try {
                child = node.getChild(i);
            } catch (Throwable ignored) {
            }
            if (child != null) {
                collect(child, d, out, upper);
                child.recycle();
            }
        }
    }

    /** Надпись закрыта окном, лежащим выше? */
    private static boolean covered(Rect r, List<Rect> upper) {
        int cx = r.centerX();
        int cy = r.centerY();
        for (Rect u : upper) if (u.contains(cx, cy)) return true;
        return false;
    }

    // ------------------------------------------ включение через системные настройки

    static String componentId(Context c) {
        return c.getPackageName() + "/" + TranslatorService.class.getName();
    }

    static boolean isEnabledInSettings(Context c) {
        try {
            String list = Settings.Secure.getString(c.getContentResolver(), "enabled_accessibility_services");
            if (list == null) return false;
            String shortId = c.getPackageName() + "/.TranslatorService";
            for (String s : list.split(":")) {
                if (s.equalsIgnoreCase(componentId(c)) || s.equalsIgnoreCase(shortId)) return true;
            }
        } catch (Throwable ignored) {
        }
        return false;
    }

    /** Требует WRITE_SECURE_SETTINGS. @return true, если служба теперь в списке включённых. */
    static boolean setEnabledInSettings(Context c, boolean enable) {
        try {
            String list = Settings.Secure.getString(c.getContentResolver(), "enabled_accessibility_services");
            String shortId = c.getPackageName() + "/.TranslatorService";
            StringBuilder sb = new StringBuilder();
            if (list != null) {
                for (String s : list.split(":")) {
                    if (s.length() == 0 || s.equalsIgnoreCase(componentId(c)) || s.equalsIgnoreCase(shortId)) continue;
                    if (sb.length() > 0) sb.append(':');
                    sb.append(s);
                }
            }
            if (enable) {
                if (sb.length() > 0) sb.append(':');
                sb.append(componentId(c));
            }
            Settings.Secure.putString(c.getContentResolver(), "enabled_accessibility_services", sb.toString());
            if (enable) Settings.Secure.putInt(c.getContentResolver(), "accessibility_enabled", 1);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }
}
