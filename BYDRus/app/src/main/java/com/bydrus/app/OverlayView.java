package com.bydrus.app;

import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.view.View;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Прозрачный слой во весь экран: поверх каждой китайской надписи рисует плашку
 * с русским переводом. Касания пропускает насквозь.
 */
final class OverlayView extends View {

    static final class Label {
        final Rect rect;
        final String text;
        final int sourceLength;
        float size;
        String[] lines = new String[0];
        boolean center;

        Label(Rect rect, String text, int sourceLength) {
            this.rect = rect;
            this.text = text;
            this.sourceLength = sourceLength;
        }
    }

    private final Paint bgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
    private final RectF tmp = new RectF();
    private final int[] origin = new int[2];
    private final float density;
    private List<Label> labels = Collections.emptyList();

    OverlayView(Context ctx) {
        super(ctx);
        density = ctx.getResources().getDisplayMetrics().density;
        setStyle(0);
    }

    /** @param style 0 — авто (по ночному режиму системы), 1 — тёмный фон, 2 — светлый фон */
    void setStyle(int style) {
        boolean dark;
        if (style == 1) {
            dark = true;
        } else if (style == 2) {
            dark = false;
        } else {
            int night = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
            dark = night != Configuration.UI_MODE_NIGHT_NO;
        }
        bgPaint.setColor(dark ? 0xF2161A22 : 0xF2F3F5F8);
        textPaint.setColor(dark ? 0xFFFFFFFF : 0xFF14171C);
        invalidate();
    }

    void setLabels(List<Label> list) {
        for (Label l : list) layout(l);
        labels = list;
        invalidate();
    }

    void clear() {
        if (labels.isEmpty()) return;
        labels = Collections.emptyList();
        invalidate();
    }

    // ---------------------------------------------------------------- вёрстка

    private void layout(Label l) {
        float w = l.rect.width();
        float h = l.rect.height();
        float pad = Math.min(6 * density, w * 0.06f);
        float avail = Math.max(1, w - 2 * pad);
        float min = 9 * density;
        float max = 34 * density;

        // Оценка исходного кегля: одна строка — по высоте, несколько — по площади.
        float size = h / 1.45f;
        int chars = Math.max(1, l.sourceLength);
        if (chars * size > w * 1.15f) {
            size = Math.min(size, (float) Math.sqrt(h * w / (1.4f * chars)));
        }
        size = Math.max(min, Math.min(max, size));

        List<String> lines;
        while (true) {
            textPaint.setTextSize(size);
            lines = wrap(l.text, avail);
            int maxLines = Math.max(1, (int) (h / (size * 1.22f)));
            if (lines.size() <= maxLines && widest(lines) <= avail) break;
            if (size <= min) {
                while (lines.size() > maxLines) lines.remove(lines.size() - 1);
                for (int i = 0; i < lines.size(); i++) lines.set(i, fit(lines.get(i), avail, i == lines.size() - 1));
                break;
            }
            size = Math.max(min, size * 0.92f);
        }
        l.size = size;
        l.lines = lines.toArray(new String[0]);
        textPaint.setTextSize(size);
        l.center = l.lines.length > 1 || w < 3f * textPaint.measureText(l.lines.length == 0 ? "" : l.lines[0]);
    }

    private List<String> wrap(String text, float width) {
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        for (String word : text.split(" ")) {
            if (word.length() == 0) continue;
            if (cur.length() == 0) {
                cur.append(word);
            } else if (textPaint.measureText(cur + " " + word) <= width) {
                cur.append(' ').append(word);
            } else {
                out.add(cur.toString());
                cur.setLength(0);
                cur.append(word);
            }
        }
        if (cur.length() > 0) out.add(cur.toString());
        if (out.isEmpty()) out.add("");
        return out;
    }

    private float widest(List<String> lines) {
        float m = 0;
        for (String s : lines) m = Math.max(m, textPaint.measureText(s));
        return m;
    }

    /** Обрезает строку с многоточием, если она не помещается даже минимальным кеглем. */
    private String fit(String s, float width, boolean forceEllipsis) {
        if (textPaint.measureText(s) <= width) return s;
        String cut = s;
        while (cut.length() > 1 && textPaint.measureText(cut + "…") > width) {
            cut = cut.substring(0, cut.length() - 1);
        }
        return cut + "…";
    }

    // --------------------------------------------------------------- отрисовка

    @Override
    protected void onDraw(Canvas canvas) {
        if (labels.isEmpty()) return;
        getLocationOnScreen(origin);
        float radius = 4 * density;
        for (Label l : labels) {
            float left = l.rect.left - origin[0];
            float top = l.rect.top - origin[1];
            float w = l.rect.width();
            float h = l.rect.height();
            tmp.set(left, top, left + w, top + h);
            canvas.drawRoundRect(tmp, radius, radius, bgPaint);

            textPaint.setTextSize(l.size);
            Paint.FontMetrics fm = textPaint.getFontMetrics();
            float lineH = fm.descent - fm.ascent;
            float total = lineH * l.lines.length;
            float y = top + (h - total) / 2f - fm.ascent;
            float pad = Math.min(6 * density, w * 0.06f);
            for (String line : l.lines) {
                float x = l.center ? left + (w - textPaint.measureText(line)) / 2f : left + pad;
                canvas.drawText(line, x, y, textPaint);
                y += lineH;
            }
        }
    }
}
