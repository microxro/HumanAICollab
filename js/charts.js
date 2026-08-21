/* ==========================================================================
   charts.js — dependency-free SVG charts

   Conventions followed throughout (see the project README):
   • Single-series plots use one hue; identity never rests on color alone —
     every per-class breakdown carries a written label next to its mark.
   • Sequential magnitude (heatmap) uses one blue ramp, light → dark.
   • Marks are thin, data-ends are rounded, grid/axes stay recessive.
   • Every plotted mark exposes a <title> so hover gives the exact value.
   ========================================================================== */

App.charts = (function () {
  /**
   * Points are carried through a DOM attribute, so a parse failure here used
   * to throw out of the interaction binder and abort the whole mount() — the
   * Grades column picker and sort handlers silently stopped working. Escaping
   * only `'` was the cause: `&` and named entities were left alone, so an
   * entity inside an assignment title was HTML-decoded by the parser and
   * corrupted the JSON. Now fully escaped on write, and tolerant on read.
   */
  function parsePoints(raw) {
    try {
      const v = JSON.parse(raw || "[]");
      return Array.isArray(v) ? v : [];
    } catch (e) {
      console.warn("[charts] unreadable data-points", e);
      return [];
    }
  }

  const U = App.utils;
  const S = App.store;

  // Charts inherit theme colors from CSS vars via classes in views.css.
  const PAD = { t: 12, r: 12, b: 24, l: 34 };

  function svg(w, h, inner, cls, ariaLabel) {
    return `<svg class="chart ${cls || ""}" viewBox="0 0 ${w} ${h}"
                 preserveAspectRatio="none" role="img" style="height:${h}px"
                 ${ariaLabel ? `aria-label="${U.esc(ariaLabel)}"` : ""}>${inner}</svg>`;
  }

  // U43 — a screen-reader summary and a real data table behind every chart
  // that's SVG-only (hbars/stackbar/ring already render their values as
  // visible text, so they don't need this).
  function altTable(caption, headers, rows) {
    return `<table class="sr-only"><caption>${U.esc(caption)}</caption>
      <thead><tr>${headers.map((h) => `<th>${U.esc(h)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${U.esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>`;
  }

  function niceMax(v) {
    if (v <= 0) return 10;
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    return Math.ceil(v / mag) * mag;
  }

  /* ------------------------------------------------------------- line -- */

  /**
   * Trend line with soft area fill. Single series → no legend needed.
   * pts: [{ date, pct, title }]
   */
  function line(pts, opts) {
    const o = Object.assign({ w: 640, h: 190, min: null, max: null, unit: "%" }, opts);
    if (!pts.length) return emptyChart(o.h, "No graded work yet");

    const w = o.w, h = o.h;
    const iw = w - PAD.l - PAD.r;
    const ih = h - PAD.t - PAD.b;

    const vals = pts.map((p) => p.pct);
    let lo = o.min != null ? o.min : Math.min(...vals) - 5;
    let hi = o.max != null ? o.max : Math.max(...vals) + 5;
    lo = Math.max(0, Math.floor(lo / 10) * 10);
    hi = Math.min(o.unit === "%" ? 100 : hi, Math.ceil(hi / 10) * 10);
    if (hi - lo < 10) hi = lo + 10;

    const x = (i) => PAD.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
    const y = (v) => PAD.t + ih - ((v - lo) / (hi - lo)) * ih;

    // Recessive gridlines + axis labels
    let grid = "";
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const v = lo + ((hi - lo) * i) / steps;
      const yy = y(v);
      grid += `<line class="grid-line" x1="${PAD.l}" y1="${yy}" x2="${w - PAD.r}" y2="${yy}" />`;
      grid += `<text class="axis-text" x="${PAD.l - 7}" y="${yy + 3.5}" text-anchor="end">${Math.round(v)}</text>`;
    }

    const d = pts.map((p, i) => `${i ? "L" : "M"}${U.round(x(i), 1)},${U.round(y(p.pct), 1)}`).join(" ");
    const area = `${d} L${U.round(x(pts.length - 1), 1)},${PAD.t + ih} L${U.round(x(0), 1)},${PAD.t + ih} Z`;

    // Label only the endpoints — never a number on every point.
    const first = pts[0], last = pts[pts.length - 1];
    const dots = pts.map((p, i) => `
      <circle class="pt" cx="${U.round(x(i), 1)}" cy="${U.round(y(p.pct), 1)}"
              r="${i === pts.length - 1 ? 5 : 3.5}">
        <title>${U.esc(p.title || U.fmtDate(p.date))} — ${U.round(p.pct, 1)}${o.unit}</title>
      </circle>`).join("");

    const endLabel = `<text class="axis-text" x="${U.round(x(pts.length - 1), 1)}" y="${U.round(y(last.pct) - 11, 1)}"
        text-anchor="end" style="font-weight:700;fill:var(--text)">${U.round(last.pct, 1)}${o.unit}</text>`;

    const xLabels = `
      <text class="axis-text" x="${PAD.l}" y="${h - 7}">${U.esc(U.fmtDate(first.date))}</text>
      <text class="axis-text" x="${w - PAD.r}" y="${h - 7}" text-anchor="end">${U.esc(U.fmtDate(last.date))}</text>`;

    // U34/U35 — a transparent capture layer over the plot area. The point
    // positions ride along as a data attribute so bindLineInteraction() can
    // do hover-crosshair and drag-to-zoom without needing the original
    // JS array — it works on whatever HTML actually got inserted.
    const ptData = pts.map((p, i) => ({
      x: U.round(x(i), 1), y: U.round(y(p.pct), 1),
      label: p.title || U.fmtDate(p.date), value: U.round(p.pct, 1), date: p.date
    }));
    const capture = `<g class="chart-crosshair-g" style="display:none">
        <line class="crosshair-line" x1="0" y1="${PAD.t}" x2="0" y2="${PAD.t + ih}" />
        <circle class="crosshair-dot" r="4" cx="0" cy="0" />
      </g>
      <rect class="chart-brush-sel" x="0" y="${PAD.t}" width="0" height="${ih}" style="display:none" />
      <rect class="chart-capture" x="${PAD.l}" y="${PAD.t}" width="${iw}" height="${ih}" fill="transparent"
            data-points="${U.esc(JSON.stringify(ptData))}" data-unit="${U.esc(o.unit)}" />`;

    const caption = opts && opts.caption || "Trend chart";
    const table = altTable(caption, ["Date", "Value"], pts.map((p) => [p.title || U.fmtDate(p.date), U.round(p.pct, 1) + o.unit]));

    return svg(w, h, `
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="var(--brand-500)" stop-opacity=".22" />
          <stop offset="100%" stop-color="var(--brand-500)" stop-opacity="0" />
        </linearGradient>
      </defs>
      ${grid}
      <path class="area" d="${area}" />
      <path class="line" d="${d}" />
      ${dots}${endLabel}${xLabels}${capture}`, "", caption) + table;
  }

  /**
   * U34/U35 — wire hover-crosshair and drag-to-zoom onto every `.chart-capture`
   * rect inside `root` (there's normally one per line() chart). Call this
   * once after inserting the chart's HTML into the DOM.
   *
   * `onZoom(startLabel, endLabel)` fires when a drag-select completes with a
   * real range (more than a few px) — the caller re-renders line() with a
   * sliced points array and offers a "Reset zoom" control; there's nothing
   * to undo in here, zoom state lives with the caller's data.
   */
  function bindLineInteraction(root, onZoom) {
    // Tooltips live in document.body (so they're never clipped by an
    // overflow:hidden card), so a repaint's fresh chart nodes wouldn't take
    // the old tooltip with them — sweep any leftover ones from a previous
    // bind on this same view before adding new ones.
    document.querySelectorAll(".chart-tip").forEach((el) => el.remove());

    root.querySelectorAll(".chart-capture").forEach((rect) => {
      const svgEl = rect.closest("svg");
      const g = svgEl.querySelector(".chart-crosshair-g");
      const line = g.querySelector(".crosshair-line");
      const dot = g.querySelector(".crosshair-dot");
      const sel = svgEl.querySelector(".chart-brush-sel");
      const tip = document.createElement("div");
      tip.className = "chart-tip";
      tip.style.display = "none";
      document.body.appendChild(tip);

      const pts = parsePoints(rect.dataset.points);
      const unit = rect.dataset.unit || "";
      let dragStartI = null;

      const svgX = (clientX) => {
        const box = svgEl.getBoundingClientRect();
        const vb = svgEl.viewBox.baseVal;
        return ((clientX - box.left) / box.width) * vb.width;
      };
      const nearest = (sx) => pts.reduce((best, p, i) =>
        Math.abs(p.x - sx) < Math.abs(pts[best].x - sx) ? i : best, 0);

      const showAt = (i, clientX, clientY) => {
        const p = pts[i];
        g.style.display = "";
        line.setAttribute("x1", p.x); line.setAttribute("x2", p.x);
        dot.setAttribute("cx", p.x); dot.setAttribute("cy", p.y);
        tip.textContent = `${p.label} — ${p.value}${unit}`;
        tip.style.display = "block";
        const vw = window.innerWidth;
        tip.style.left = Math.max(4, Math.min(clientX + 12, vw - tip.offsetWidth - 4)) + "px";
        tip.style.top = Math.max(4, clientY - 34) + "px";
      };
      const hide = () => { g.style.display = "none"; tip.style.display = "none"; };

      rect.addEventListener("pointermove", (e) => {
        const i = nearest(svgX(e.clientX));
        showAt(i, e.clientX, e.clientY);
        if (dragStartI != null) {
          const lo = Math.min(dragStartI, i), hi = Math.max(dragStartI, i);
          sel.style.display = "block";
          sel.setAttribute("x", pts[lo].x);
          sel.setAttribute("width", Math.max(1, pts[hi].x - pts[lo].x));
        }
      });
      rect.addEventListener("pointerleave", () => { if (dragStartI == null) hide(); });
      rect.addEventListener("pointerdown", (e) => {
        dragStartI = nearest(svgX(e.clientX));
        rect.setPointerCapture(e.pointerId);
      });
      rect.addEventListener("pointerup", (e) => {
        if (dragStartI == null) return;
        const endI = nearest(svgX(e.clientX));
        sel.style.display = "none";
        const lo = Math.min(dragStartI, endI), hi = Math.max(dragStartI, endI);
        dragStartI = null;
        if (hi - lo >= 1 && onZoom) onZoom(pts[lo].date, pts[hi].date);
      });
    });
  }

  /* -------------------------------------------------------------- bars -- */

  /**
   * Vertical bars, single hue. rows: [{ label, value, highlight }]
   * Rounded data-ends anchored to the baseline, 2px gap between bars.
   */
  function bars(rows, opts) {
    const o = Object.assign({ w: 640, h: 180, unit: "", labelEvery: 1, fmt: null }, opts);
    if (!rows.length) return emptyChart(o.h, "No data yet");

    const w = o.w, h = o.h;
    const iw = w - PAD.l - PAD.r;
    const ih = h - PAD.t - PAD.b;
    const max = niceMax(Math.max(...rows.map((r) => r.value), 1));

    const slot = iw / rows.length;
    const bw = Math.max(3, Math.min(30, slot - 4));   // 4px total gutter
    const y = (v) => PAD.t + ih - (v / max) * ih;

    let grid = "";
    for (let i = 0; i <= 2; i++) {
      const v = (max * i) / 2;
      const yy = y(v);
      grid += `<line class="grid-line" x1="${PAD.l}" y1="${yy}" x2="${w - PAD.r}" y2="${yy}" />`;
      grid += `<text class="axis-text" x="${PAD.l - 7}" y="${yy + 3.5}" text-anchor="end">${Math.round(v)}</text>`;
    }

    const marks = rows.map((r, i) => {
      const bx = PAD.l + slot * i + (slot - bw) / 2;
      const bh = Math.max(r.value > 0 ? 2 : 0, (r.value / max) * ih);
      const by = PAD.t + ih - bh;
      const label = (i % o.labelEvery === 0)
        ? `<text class="axis-text" x="${U.round(bx + bw / 2, 1)}" y="${h - 7}" text-anchor="middle">${U.esc(r.label)}</text>`
        : "";
      return `<rect class="bar-r ${r.highlight ? "" : "alt"}" x="${U.round(bx, 1)}" y="${U.round(by, 1)}"
                    width="${U.round(bw, 1)}" height="${U.round(bh, 1)}" rx="4">
                <title>${U.esc(r.full || r.label)} — ${o.fmt ? o.fmt(r.value) : r.value + o.unit}</title>
              </rect>${label}`;
    }).join("");

    const caption = opts && opts.caption || "Bar chart";
    const table = altTable(caption, ["Label", "Value"],
      rows.map((r) => [r.full || r.label, o.fmt ? o.fmt(r.value) : r.value + o.unit]));
    return svg(w, h, grid + marks, "", caption) + table;
  }

  /**
   * Horizontal bars with a written label per row — the form to use for any
   * per-class/per-category breakdown, since the label carries identity and
   * the color is only reinforcement.
   * rows: [{ label, value, color, note }]
   */
  function hbars(rows, opts) {
    const o = Object.assign({ unit: "", fmt: null, max: null }, opts);
    if (!rows.length) return `<p class="dim small center" style="padding:20px">No data yet</p>`;
    const max = o.max != null ? o.max : Math.max(...rows.map((r) => r.value), 1);

    return `<div class="col gap-8">${rows.map((r) => {
      const pct = max ? U.clamp((r.value / max) * 100, 0, 100) : 0;
      const color = S.chartColor(r.color || "");
      return `<div>
        <div class="between" style="margin-bottom:4px">
          <span class="row gap-6 small" style="min-width:0">
            ${r.color ? `<i class="dot-badge" style="background:${U.esc(color)}"></i>` : ""}
            <span class="truncate">${U.esc(r.label)}</span>
          </span>
          <span class="small bold nums nowrap">${o.fmt ? o.fmt(r.value) : U.esc(r.value + o.unit)}</span>
        </div>
        <div class="bar" title="${U.esc(r.label)} — ${o.fmt ? o.fmt(r.value) : r.value + o.unit}">
          <i style="width:${U.round(pct, 1)}%${r.color ? `;background:${U.esc(color)}` : ""}"></i>
        </div>
        ${r.note ? `<div class="tiny dim" style="margin-top:3px">${U.esc(r.note)}</div>` : ""}
      </div>`;
    }).join("")}</div>`;
  }

  /* -------------------------------------------------------------- ring -- */

  function ring(pct, opts) {
    const o = Object.assign({ size: 92, stroke: 9, label: null, color: null }, opts);
    const r = (o.size - o.stroke) / 2;
    const c = 2 * Math.PI * r;
    const off = c * (1 - U.clamp(pct, 0, 100) / 100);
    const color = o.color || "var(--brand-500)";
    return `<span class="ring-wrap" style="width:${o.size}px;height:${o.size}px">
      <svg width="${o.size}" height="${o.size}" class="timer-ring" aria-hidden="true">
        <circle class="track" cx="${o.size / 2}" cy="${o.size / 2}" r="${r}" stroke-width="${o.stroke}" />
        <circle class="prog"  cx="${o.size / 2}" cy="${o.size / 2}" r="${r}" stroke-width="${o.stroke}"
                stroke="${color}" stroke-dasharray="${U.round(c, 2)}" stroke-dashoffset="${U.round(off, 2)}" />
      </svg>
      <span class="ring-label">${o.label != null ? o.label : Math.round(pct) + "%"}</span>
    </span>`;
  }

  /* ----------------------------------------------------------- heatmap -- */

  /**
   * GitHub-style activity heatmap. Sequential single hue, light → dark.
   * days: [{ date, minutes }]
   */
  function heatmap(days, opts) {
    const o = Object.assign({ unit: "min" }, opts);
    const max = Math.max(...days.map((d) => d.minutes), 1);
    const level = (v) => (v <= 0 ? 0 : v < max * 0.25 ? 1 : v < max * 0.5 ? 2 : v < max * 0.78 ? 3 : 4);

    // Pad the front so the first column starts on the right weekday row.
    const firstDow = U.parseDate(days[0].date).getDay();
    const pad = Array.from({ length: firstDow }, () => null);

    const cells = [...pad, ...days].map((d) => {
      if (!d) return `<span class="heat-cell" style="visibility:hidden"></span>`;
      return `<span class="heat-cell" data-lv="${level(d.minutes)}"
                    title="${U.esc(U.fmtDate(d.date, "day"))} — ${d.minutes} ${o.unit}"></span>`;
    }).join("");

    return `<div class="scroll-x"><div class="heatmap">${cells}</div></div>
      <div class="row gap-6 tiny dim" style="margin-top:8px;justify-content:flex-end">
        <span>Less</span>
        ${[0, 1, 2, 3, 4].map((l) => `<span class="heat-cell" data-lv="${l}"></span>`).join("")}
        <span>More</span>
      </div>`;
  }

  /* ------------------------------------------------------------ stacks -- */

  /**
   * A single 100%-wide composition bar with a 2px surface gap between
   * segments. Always rendered with an accompanying labeled legend.
   * segs: [{ label, value, color }]
   */
  function stackbar(segs, opts) {
    const o = Object.assign({ height: 12 }, opts);
    const total = U.sum(segs, (s) => s.value) || 1;
    return `<div class="row" style="gap:2px;height:${o.height}px">
      ${segs.filter((s) => s.value > 0).map((s, i, arr) => `
        <span title="${U.esc(s.label)} — ${s.value}"
              style="flex:${s.value};background:${U.esc(S.chartColor(s.color))};height:100%;
                     border-radius:${i === 0 ? "6px 0 0 6px" : i === arr.length - 1 ? "0 6px 6px 0" : "0"}"></span>`).join("")}
    </div>
    <div class="legend">
      ${segs.filter((s) => s.value > 0).map((s) => `
        <span class="legend-item">
          <i class="legend-swatch" style="background:${U.esc(S.chartColor(s.color))}"></i>
          ${U.esc(s.label)} <span class="dim">${Math.round((s.value / total) * 100)}%</span>
        </span>`).join("")}
    </div>`;
  }

  /* ------------------------------------------------------------- misc -- */

  function sparkline(vals, opts) {
    const o = Object.assign({ w: 110, h: 30, color: "var(--brand-500)" }, opts);
    if (!vals.length) return "";
    const max = Math.max(...vals, 1), min = Math.min(...vals, 0);
    const span = max - min || 1;
    const d = vals.map((v, i) =>
      `${i ? "L" : "M"}${U.round((i / Math.max(1, vals.length - 1)) * o.w, 1)},${U.round(o.h - ((v - min) / span) * o.h, 1)}`
    ).join(" ");
    return `<svg class="chart" viewBox="0 0 ${o.w} ${o.h}" style="width:${o.w}px;height:${o.h}px" aria-hidden="true">
      <path d="${d}" fill="none" stroke="${o.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>`;
  }

  function emptyChart(h, msg) {
    return `<div class="center dim small" style="height:${h}px;display:grid;place-items:center">${U.esc(msg)}</div>`;
  }

  return { line, bars, hbars, ring, heatmap, stackbar, sparkline, bindLineInteraction };
})();
