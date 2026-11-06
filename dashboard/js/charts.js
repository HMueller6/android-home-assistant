/*
 * Habitat — charts. Small SVG strings for tiles (sparkline, arc gauge, meter) and interactive
 * DOM charts for the detail view (line with crosshair, columns, state timeline).
 */
(function (HB) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const { HOUR, DAY } = HB.MS;
  const charts = (HB.charts = {});

  /** Averages [t, v] points into at most `buckets` points across the time span. */
  function downsample(points, buckets) {
    if (points.length <= buckets) return points;
    const t0 = points[0][0];
    const span = points[points.length - 1][0] - t0 || 1;
    const out = [];
    let bucket = -1;
    let sumT = 0;
    let sumV = 0;
    let n = 0;
    for (const [t, v] of points) {
      const b = Math.min(buckets - 1, Math.floor(((t - t0) / span) * buckets));
      if (b !== bucket && n) {
        out.push([sumT / n, sumV / n]);
        sumT = 0;
        sumV = 0;
        n = 0;
      }
      bucket = b;
      sumT += t;
      sumV += v;
      n += 1;
    }
    if (n) out.push([sumT / n, sumV / n]);
    return out;
  }
  charts.downsample = downsample;

  function extent(points) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const [, v] of points) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return [lo, hi];
  }

  function niceStep(range, count) {
    const raw = range / count;
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    const normalized = raw / magnitude;
    const step = normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10;
    return step * magnitude;
  }

  /** Rounded axis ticks covering [lo, hi]. */
  function niceTicks(lo, hi, count = 4) {
    let min = lo;
    let max = hi;
    if (max - min < 1e-9) {
      const pad = Math.abs(min) * 0.05 || 1;
      min -= pad;
      max += pad;
    }
    const step = niceStep(max - min, count);
    const start = Math.floor(min / step) * step;
    const end = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = start; v <= end + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
    return { ticks, lo: start, hi: end, step };
  }

  function tickDigits(step) {
    return step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
  }

  /** Time ticks aligned to local hours or midnights, spaced to fit the plot width. */
  function timeTicks(start, end, width) {
    const steps = [HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY];
    const maxTicks = Math.max(2, Math.floor(width / 76));
    const step = steps.find((s) => (end - start) / s <= maxTicks) || steps[steps.length - 1];
    const d = new Date(start);
    d.setMinutes(0, 0, 0);
    if (step >= DAY) {
      d.setHours(0);
    } else {
      const hours = step / HOUR;
      d.setHours(Math.ceil(d.getHours() / hours) * hours);
    }
    const ticks = [];
    while (d.getTime() <= end) {
      const t = d.getTime();
      if (t >= start) ticks.push({ t, label: step >= DAY || (d.getHours() === 0 && end - start > DAY) ? HB.fmtWeekday(t) : HB.fmtTime(t) });
      if (step >= DAY) d.setDate(d.getDate() + step / DAY);
      else d.setHours(d.getHours() + step / HOUR);
    }
    return ticks;
  }

  function svgEl(tag, attrs, parent) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (parent) parent.appendChild(node);
    return node;
  }

  function svgText(parent, x, y, text, attrs = {}) {
    const node = svgEl('text', { x, y, ...attrs }, parent);
    node.textContent = text;
    return node;
  }

  function pathFrom(points, x, y) {
    return points.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join('');
  }

  // ---- Tile charts (HTML strings) -------------------------------------------------------------

  /**
   * Sparkline over a fixed window. The SVG stretches to the tile; the end dot is an HTML element
   * so it stays round at any aspect ratio.
   */
  charts.sparkline = (points, { start, end }) => {
    const visible = points.filter(([t]) => t >= start);
    if (visible.length < 2) return '';
    const pts = downsample(visible, 60);
    let [lo, hi] = extent(pts);
    if (hi - lo < 1e-9) {
      lo -= 1;
      hi += 1;
    }
    const pad = (hi - lo) * 0.15;
    lo -= pad;
    hi += pad;
    const H = 32;
    const x = (t) => ((t - start) / (end - start)) * 100;
    const y = (v) => H - ((v - lo) / (hi - lo)) * H;
    const line = pathFrom(pts, x, y);
    const first = pts[0];
    const last = pts[pts.length - 1];
    const area = `${line}L${x(last[0]).toFixed(1)},${H}L${x(first[0]).toFixed(1)},${H}Z`;
    return (
      `<div class="spark"><svg viewBox="0 0 100 ${H}" preserveAspectRatio="none" aria-hidden="true">` +
      `<path class="spark__area" d="${area}"/><path class="spark__line" d="${line}"/></svg>` +
      `<i class="spark__dot" style="left:${x(last[0]).toFixed(2)}%;top:${((y(last[1]) / H) * 100).toFixed(2)}%"></i></div>`
    );
  };

  const GAUGE = { cx: 50, cy: 50, r: 40, start: 150, sweep: 240 };

  function polar(angle, radius) {
    const rad = (angle * Math.PI) / 180;
    return [GAUGE.cx + radius * Math.cos(rad), GAUGE.cy + radius * Math.sin(rad)];
  }

  function arcPath(radius) {
    const [x0, y0] = polar(GAUGE.start, radius);
    const [x1, y1] = polar(GAUGE.start + GAUGE.sweep, radius);
    return `M${x0.toFixed(2)},${y0.toFixed(2)}A${radius},${radius} 0 1 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
  }

  /**
   * 240° arc meter. The track is a light step of the fill's own hue; `severity` recolours the
   * fill (accent / warning / critical) and an optional marker shows a target on the scale.
   */
  charts.arcGauge = (fraction, { severity = 'accent', marker = null, ticks = 10 } = {}) => {
    const f = HB.clamp(Number.isFinite(fraction) ? fraction : 0, 0, 1);
    const length = 2 * Math.PI * GAUGE.r * (GAUGE.sweep / 360);
    let tickMarks = '';
    for (let i = 0; i <= ticks; i += 1) {
      const angle = GAUGE.start + (GAUGE.sweep * i) / ticks;
      const [x0, y0] = polar(angle, GAUGE.r + 6);
      const [x1, y1] = polar(angle, GAUGE.r + (i % 5 === 0 ? 10 : 8));
      tickMarks += `M${x0.toFixed(2)},${y0.toFixed(2)}L${x1.toFixed(2)},${y1.toFixed(2)}`;
    }
    let markerEl = '';
    if (marker != null && Number.isFinite(marker)) {
      const angle = GAUGE.start + GAUGE.sweep * HB.clamp(marker, 0, 1);
      const [x0, y0] = polar(angle, GAUGE.r - 7);
      const [x1, y1] = polar(angle, GAUGE.r + 7);
      markerEl = `<path class="gauge__marker" d="M${x0.toFixed(2)},${y0.toFixed(2)}L${x1.toFixed(2)},${y1.toFixed(2)}"/>`;
    }
    return (
      `<svg class="gauge gauge--${severity}" viewBox="0 -2 100 80" aria-hidden="true">` +
      `<path class="gauge__ticks" d="${tickMarks}"/>` +
      `<path class="gauge__track" d="${arcPath(GAUGE.r)}"/>` +
      `<path class="gauge__fill" d="${arcPath(GAUGE.r)}" stroke-dasharray="${(length * f).toFixed(2)} ${length.toFixed(2)}"/>` +
      `${markerEl}</svg>`
    );
  };

  /** Horizontal meter; `segmented` draws it as cells with surface gaps, like a battery. */
  charts.meter = (fraction, { severity = 'accent', segmented = false } = {}) => {
    const f = HB.clamp(Number.isFinite(fraction) ? fraction : 0, 0, 1);
    return `<span class="meter meter--${severity}${segmented ? ' meter--seg' : ''}" style="--v:${f.toFixed(3)}"><i></i></span>`;
  };

  /** Severity for a value against warning/critical thresholds (ascending or descending). */
  charts.severity = (value, warning, critical, descending = false) => {
    if (!Number.isFinite(value)) return 'accent';
    if (descending) return value <= critical ? 'critical' : value <= warning ? 'warning' : 'accent';
    return value >= critical ? 'critical' : value >= warning ? 'warning' : 'accent';
  };

  // ---- Detail charts (DOM, interactive) -------------------------------------------------------

  function makeTooltip(host) {
    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    const value = document.createElement('strong');
    const label = document.createElement('span');
    tip.append(value, label);
    host.appendChild(tip);
    return {
      show(x, y, valueText, labelText) {
        value.textContent = valueText;
        label.textContent = labelText;
        tip.hidden = false;
        const width = tip.offsetWidth;
        const left = x + 14 + width > host.clientWidth ? x - 14 - width : x + 14;
        tip.style.transform = `translate(${Math.max(0, left)}px, ${Math.max(0, y - 18)}px)`;
      },
      hide() {
        tip.hidden = true;
      },
    };
  }

  function setupFrame(host, { height, yTicks, format }) {
    host.replaceChildren();
    const width = Math.max(280, host.clientWidth);
    const labelWidth = Math.max(...yTicks.map((v) => format(v).length)) * 7 + 12;
    const m = { top: 12, right: 12, bottom: 26, left: labelWidth };
    const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img' }, host);
    return { svg, width, height, m, plotW: width - m.left - m.right, plotH: height - m.top - m.bottom };
  }

  function drawAxes(frame, { yTicks, y, format, start, end, x }) {
    const { svg, m, width, height } = frame;
    const grid = svgEl('g', { class: 'chart__grid' }, svg);
    for (const v of yTicks) {
      const py = y(v).toFixed(1);
      svgEl('line', { x1: m.left, x2: width - m.right, y1: py, y2: py }, grid);
      svgText(grid, m.left - 8, Number(py) + 3.5, format(v), { 'text-anchor': 'end' });
    }
    const axis = svgEl('g', { class: 'chart__axis' }, svg);
    svgEl('line', { x1: m.left, x2: width - m.right, y1: height - m.bottom, y2: height - m.bottom, class: 'chart__baseline' }, axis);
    for (const tick of timeTicks(start, end, frame.plotW)) {
      svgText(axis, x(tick.t).toFixed(1), height - m.bottom + 16, tick.label, { 'text-anchor': 'middle' });
    }
  }

  function nearestIndex(points, t) {
    let lo = 0;
    let hi = points.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (points[mid][0] < t) lo = mid;
      else hi = mid;
    }
    return Math.abs(points[lo][0] - t) <= Math.abs(points[hi][0] - t) ? lo : hi;
  }

  /**
   * Line chart with an area wash, hairline grid, and a crosshair that snaps to the nearest sample.
   * Arrow keys move the crosshair when the chart has focus.
   */
  charts.lineChart = (host, rawPoints, { start, end, unit = '', precision = null, height = 230, label = '' }) => {
    if (rawPoints.length < 2) {
      host.innerHTML = '<p class="chart-empty">Not enough history in this range yet.</p>';
      return;
    }
    const prelim = Math.max(280, host.clientWidth);
    const points = downsample(rawPoints, Math.floor(prelim / 2));
    const [lo, hi] = extent(points);
    const scale = niceTicks(lo, hi, 4);
    const digits = tickDigits(scale.step);
    const format = (v) => HB.formatNumber(v, digits);
    const frame = setupFrame(host, { height, yTicks: scale.ticks, format });
    const { svg, m, plotW, plotH } = frame;
    const x = (t) => m.left + ((t - start) / (end - start)) * plotW;
    const y = (v) => m.top + plotH - ((v - scale.lo) / (scale.hi - scale.lo)) * plotH;
    svg.setAttribute('aria-label', `${label} from ${HB.fmtDayTime(start)} to ${HB.fmtDayTime(end)}, range ${format(lo)} to ${format(hi)} ${unit}`);
    drawAxes(frame, { yTicks: scale.ticks, y, format, start, end, x });
    const line = pathFrom(points, x, y);
    const base = (m.top + plotH).toFixed(1);
    svgEl('path', { class: 'chart__area', d: `${line}L${x(points[points.length - 1][0]).toFixed(1)},${base}L${x(points[0][0]).toFixed(1)},${base}Z` }, svg);
    svgEl('path', { class: 'chart__line', d: line }, svg);
    const last = points[points.length - 1];
    svgEl('circle', { class: 'chart__end', cx: x(last[0]).toFixed(1), cy: y(last[1]).toFixed(1), r: 4 }, svg);

    const cross = svgEl('g', { class: 'chart__cross', visibility: 'hidden' }, svg);
    const crossLine = svgEl('line', { y1: m.top, y2: m.top + plotH }, cross);
    const crossDot = svgEl('circle', { r: 4 }, cross);
    const tip = makeTooltip(host);
    let index = points.length - 1;

    function show(i) {
      index = HB.clamp(i, 0, points.length - 1);
      const [t, v] = points[index];
      const px = x(t);
      const py = y(v);
      crossLine.setAttribute('x1', px.toFixed(1));
      crossLine.setAttribute('x2', px.toFixed(1));
      crossDot.setAttribute('cx', px.toFixed(1));
      crossDot.setAttribute('cy', py.toFixed(1));
      cross.setAttribute('visibility', 'visible');
      tip.show(px, py, `${HB.formatNumber(v, precision ?? Math.max(digits, 1))} ${unit}`.trim(), HB.fmtDayTime(t));
    }
    function hide() {
      cross.setAttribute('visibility', 'hidden');
      tip.hide();
    }
    const hit = svgEl('rect', { class: 'chart__hit', x: m.left, y: m.top, width: plotW, height: plotH }, svg);
    hit.addEventListener('pointermove', (event) => {
      const rect = svg.getBoundingClientRect();
      const t = start + ((event.clientX - rect.left - m.left) / plotW) * (end - start);
      show(nearestIndex(points, t));
    });
    hit.addEventListener('pointerleave', hide);
    host.tabIndex = 0;
    host.onkeydown = (event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        show(index + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1));
      } else if (event.key === 'Escape') {
        hide();
      }
    };
    host.onfocus = () => show(index);
    host.onblur = hide;
  };

  /** Column chart for per-period totals (energy per hour/day). Each column is its own hover target. */
  charts.barChart = (host, bars, { start, end, unit = '', height = 230, label = '', periodLabel }) => {
    if (!bars.length) {
      host.innerHTML = '<p class="chart-empty">No statistics recorded in this range.</p>';
      return;
    }
    const values = bars.map((bar) => bar.value);
    const scale = niceTicks(Math.min(0, ...values), Math.max(0, ...values), 4);
    const digits = tickDigits(scale.step);
    const format = (v) => HB.formatNumber(v, digits);
    const frame = setupFrame(host, { height, yTicks: scale.ticks, format });
    const { svg, m, plotW, plotH } = frame;
    const x = (t) => m.left + ((t - start) / (end - start)) * plotW;
    const y = (v) => m.top + plotH - ((v - scale.lo) / (scale.hi - scale.lo)) * plotH;
    svg.setAttribute('aria-label', `${label}: ${bars.length} periods, peak ${format(Math.max(...values))} ${unit}`);
    drawAxes(frame, { yTicks: scale.ticks, y, format, start, end, x });
    const tip = makeTooltip(host);
    const zero = y(0);
    const radius = 4;
    for (const bar of bars) {
      const band = x(bar.end) - x(bar.start);
      const w = Math.max(2, Math.min(24, band - 2));
      const left = x(bar.start) + (band - w) / 2;
      const top = y(Math.max(bar.value, 0));
      const bottom = y(Math.min(bar.value, 0));
      const h = Math.max(1, bottom - top);
      const r = Math.min(radius, w / 2, h);
      const d =
        bar.value >= 0
          ? `M${left},${zero}V${top + r}Q${left},${top} ${left + r},${top}H${left + w - r}Q${left + w},${top} ${left + w},${top + r}V${zero}Z`
          : `M${left},${zero}V${bottom - r}Q${left},${bottom} ${left + r},${bottom}H${left + w - r}Q${left + w},${bottom} ${left + w},${bottom - r}V${zero}Z`;
      const mark = svgEl('path', { class: 'chart__bar', d }, svg);
      const hit = svgEl('rect', { class: 'chart__hit', x: x(bar.start), y: m.top, width: Math.max(band, 1), height: plotH }, svg);
      hit.addEventListener('pointerenter', () => {
        mark.classList.add('is-hover');
        tip.show(left + w / 2, top, `${HB.formatNumber(bar.value, 2)} ${unit}`.trim(), periodLabel(bar));
      });
      hit.addEventListener('pointerleave', () => {
        mark.classList.remove('is-hover');
        tip.hide();
      });
    }
  };

  /** Single-row state timeline; hovering anywhere shows the state and how long it lasted. */
  charts.timeline = (host, segments, { start, end, label = '' }) => {
    host.replaceChildren();
    if (!segments.length) {
      host.innerHTML = '<p class="chart-empty">No state changes recorded in this range.</p>';
      return;
    }
    const width = Math.max(280, host.clientWidth);
    const height = 64;
    const m = { top: 8, right: 12, bottom: 26, left: 12 };
    const plotW = width - m.left - m.right;
    const band = 28;
    const svg = svgEl('svg', { class: 'chart chart--timeline', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img' }, host);
    svg.setAttribute('aria-label', `${label}: ${segments.length} state periods from ${HB.fmtDayTime(start)}`);
    const x = (t) => m.left + ((HB.clamp(t, start, end) - start) / (end - start)) * plotW;
    svgEl('rect', { class: 'chart__track', x: m.left, y: m.top, width: plotW, height: band, rx: 3 }, svg);
    segments.forEach((seg, i) => {
      if (!seg.active) return;
      const prevActive = i > 0 && segments[i - 1].active;
      const nextActive = i < segments.length - 1 && segments[i + 1].active;
      const x0 = x(seg.from) + (prevActive ? 1 : 0);
      const x1 = x(seg.to) - (nextActive ? 1 : 0);
      svgEl('rect', { class: 'chart__seg', x: x0.toFixed(1), y: m.top, width: Math.max(1.5, x1 - x0).toFixed(1), height: band, rx: 3 }, svg);
    });
    const axis = svgEl('g', { class: 'chart__axis' }, svg);
    for (const tick of timeTicks(start, end, plotW)) svgText(axis, x(tick.t).toFixed(1), height - 8, tick.label, { 'text-anchor': 'middle' });
    const tip = makeTooltip(host);
    const hit = svgEl('rect', { class: 'chart__hit', x: m.left, y: m.top, width: plotW, height: band }, svg);
    hit.addEventListener('pointermove', (event) => {
      const rect = svg.getBoundingClientRect();
      const t = start + ((event.clientX - rect.left - m.left) / plotW) * (end - start);
      const seg = segments.find((s) => t >= s.from && t < s.to) || segments[segments.length - 1];
      tip.show(event.clientX - rect.left, m.top, seg.label, `${HB.fmtDayTime(seg.from)} · ${HB.fmtDuration(seg.to - seg.from)}`);
    });
    hit.addEventListener('pointerleave', () => tip.hide());
  };
})(window.HB = window.HB || {});
