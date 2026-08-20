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
  const U = App.utils;
  const S = App.store;

  // Charts inherit theme colors from CSS vars via classes in views.css.
  const PAD = { t: 12, r: 12, b: 24, l: 34 };

  function svg(w, h, inner, cls) {
    return `<svg class="chart ${cls || ""}" viewBox="0 0 ${w} ${h}"
                 preserveAspectRatio="none" role="img" style="height:${h}px">${inner}</svg>`;
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
      ${dots}${endLabel}${xLabels}`);
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

    return svg(w, h, grid + marks);
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

  return { line, bars, hbars, ring, heatmap, stackbar, sparkline };
})();
