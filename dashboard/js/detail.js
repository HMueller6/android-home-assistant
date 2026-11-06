/*
 * Habitat — detail view. Opens from any tile: current value, controls, a history chart with
 * selectable range (or its table twin), and every attribute the entity reports.
 */
(function (HB) {
  'use strict';

  const { HOUR, DAY } = HB.MS;
  const esc = HB.esc;
  const RANGES = [
    { id: '6h', label: '6H', span: 6 * HOUR },
    { id: '24h', label: '24H', span: DAY },
    { id: '3d', label: '3D', span: 3 * DAY },
    { id: '7d', label: '7D', span: 7 * DAY },
  ];
  const DEFAULT_RANGE = '24h';
  const TABLE_ROW_LIMIT = 168;
  const LOG_LIMIT = 12;
  const ACTIVE_STATES = new Set([
    'on', 'open', 'opening', 'closing', 'unlocked', 'unlocking', 'home', 'playing', 'buffering', 'heat', 'cool',
    'heat_cool', 'auto', 'dry', 'fan_only', 'cleaning', 'triggered', 'armed_home', 'armed_away', 'armed_night',
    'armed_vacation', 'armed_custom_bypass', 'mowing',
  ]);
  const TIMELINE_DOMAINS = new Set([
    'binary_sensor', 'light', 'switch', 'input_boolean', 'fan', 'lock', 'cover', 'person', 'device_tracker',
    'media_player', 'alarm_control_panel', 'vacuum', 'lawn_mower', 'valve', 'humidifier', 'water_heater',
  ]);
  const COVER_SET_POSITION = 4;
  const MEDIA_VOLUME_SET = 4;
  const FAN_SET_SPEED = 1;

  let view = null;
  let dialog = null;
  let resizeTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function chartMode(st) {
    const domain = HB.domainOf(st.entity_id);
    if (domain === 'climate') return { type: 'attr', attr: 'current_temperature' };
    if (domain === 'weather') return { type: 'attr', attr: 'temperature' };
    if (domain === 'sensor') {
      const numeric = HB.isNumeric(st.state) || st.attributes.unit_of_measurement;
      if (!numeric) return { type: 'log' };
      return HB.isAccumulating(st) ? { type: 'bars' } : { type: 'line' };
    }
    if (TIMELINE_DOMAINS.has(domain)) return { type: 'timeline' };
    return { type: 'log' };
  }

  function isActive(entityId, state) {
    if (HB.domainOf(entityId) === 'lock') return state === 'unlocked' || state === 'open';
    return ACTIVE_STATES.has(state);
  }

  // ---- Data loading -------------------------------------------------------------------------

  function historyRequest(id, start, end, withAttributes) {
    return HB.app.backend.send({
      type: 'history/history_during_period',
      start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(),
      entity_ids: [id],
      minimal_response: !withAttributes,
      no_attributes: !withAttributes,
      significant_changes_only: false,
    });
  }

  function statisticsRequest(id, start, end, period, types) {
    return HB.app.backend.send({
      type: 'recorder/statistics_during_period',
      start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(),
      statistic_ids: [id],
      period,
      types,
    });
  }

  /** Parses compressed history rows into numeric [time, value] points. */
  HB.numericPoints = (rows, pick = (row) => row.s) => {
    const points = [];
    for (const row of rows || []) {
      const value = pick(row);
      const t = HB.toMs(row.lu ?? row.lc);
      if (value != null && HB.isNumeric(String(value)) && Number.isFinite(t)) points.push([t, Number(value)]);
    }
    return points;
  };

  function toSegments(rows, id, end) {
    const segments = [];
    (rows || []).forEach((row, i) => {
      const from = HB.toMs(row.lu ?? row.lc);
      const to = i < rows.length - 1 ? HB.toMs(rows[i + 1].lu ?? rows[i + 1].lc) : end;
      const st = { entity_id: id, state: row.s, attributes: HB.app.states.get(id)?.attributes || {} };
      if (to > from) segments.push({ from, to, state: row.s, active: isActive(id, row.s), label: HB.stateLabel(st) });
    });
    return segments;
  }

  async function loadLine(st, start, end, span) {
    const id = st.entity_id;
    if (span > DAY && st.attributes.state_class) {
      const stats = await statisticsRequest(id, start, end, 'hour', ['mean']);
      const rows = stats[id] || [];
      if (rows.length) return rows.filter((row) => Number.isFinite(row.mean)).map((row) => [(HB.toMs(row.start) + HB.toMs(row.end)) / 2, row.mean]);
    }
    const result = await historyRequest(id, start, end, false);
    const points = HB.numericPoints(result[id]);
    if (points.length && HB.isNumeric(st.state)) points.push([end, Number(st.state)]);
    return points;
  }

  async function loadBars(st, start, end, span) {
    const id = st.entity_id;
    const period = span > 3 * DAY ? 'day' : 'hour';
    try {
      const stats = await statisticsRequest(id, start, end, period, ['change']);
      const rows = (stats[id] || []).filter((row) => Number.isFinite(row.change));
      if (rows.length) return { kind: 'bars', period, bars: rows.map((row) => ({ start: HB.toMs(row.start), end: HB.toMs(row.end), value: row.change })) };
    } catch (_) {
      /* statistics unavailable for this entity: fall back to the raw meter line */
    }
    return { kind: 'line', points: await loadLine(st, start, end, 0) };
  }

  async function loadData(st, mode, range) {
    const end = Date.now();
    const start = end - range.span;
    const id = st.entity_id;
    if (mode.type === 'line') return { kind: 'line', start, end, points: await loadLine(st, start, end, range.span) };
    if (mode.type === 'bars') return { start, end, ...(await loadBars(st, start, end, range.span)) };
    if (mode.type === 'attr') {
      const result = await historyRequest(id, start, end, true);
      let last = null;
      const points = HB.numericPoints(result[id], (row) => {
        if (row.a && row.a[mode.attr] != null) last = row.a[mode.attr];
        return last;
      });
      return { kind: 'line', start, end, points };
    }
    const result = await historyRequest(id, start, end, false);
    return { kind: mode.type === 'timeline' ? 'timeline' : 'log', start, end, segments: toSegments(result[id], id, end) };
  }

  // ---- Rendering ----------------------------------------------------------------------------

  function unitFor(st, mode) {
    if (mode.type === 'attr') return st.attributes.temperature_unit || HB.app.units().temperature || '';
    return st.attributes.unit_of_measurement || '';
  }

  function statsFor(data, st, mode) {
    const unit = unitFor(st, mode);
    const precision = HB.app.precision(st.entity_id);
    const fmt = (v) => `${HB.formatNumber(v, precision ?? 1)} ${unit}`.trim();
    if (data.kind === 'line' && data.points.length) {
      const values = data.points.map(([, v]) => v);
      let weighted = 0;
      for (let i = 0; i < data.points.length - 1; i += 1) weighted += data.points[i][1] * (data.points[i + 1][0] - data.points[i][0]);
      const span = data.points[data.points.length - 1][0] - data.points[0][0];
      const avg = span > 0 ? weighted / span : values[0];
      return [['Min', fmt(Math.min(...values))], ['Average', fmt(avg)], ['Max', fmt(Math.max(...values))]];
    }
    if (data.kind === 'bars' && data.bars.length) {
      const values = data.bars.map((bar) => bar.value);
      const total = values.reduce((sum, v) => sum + v, 0);
      const fmt2 = (v) => `${HB.formatNumber(v, 2)} ${unit}`.trim();
      return [['Total', fmt2(total)], [`Peak ${data.period}`, fmt2(Math.max(...values))], [`Average ${data.period}`, fmt2(total / values.length)]];
    }
    if ((data.kind === 'timeline' || data.kind === 'log') && data.segments.length) {
      const active = data.segments.filter((seg) => seg.active).reduce((sum, seg) => sum + seg.to - seg.from, 0);
      const changes = Math.max(0, data.segments.length - 1);
      const rows = [['Changes', String(changes)]];
      if (data.kind === 'timeline') rows.unshift(['Active', HB.fmtDuration(active)], ['Share', `${Math.round((active / (data.end - data.start)) * 100)}%`]);
      return rows;
    }
    return [];
  }

  function periodLabel(period) {
    return (bar) => (period === 'day' ? HB.fmtDayDate(bar.start) : `${HB.fmtWeekday(bar.start)} ${HB.fmtTime(bar.start)}–${HB.fmtTime(bar.end)}`);
  }

  function tableHtml(data, st, mode) {
    const unit = unitFor(st, mode);
    let head = '';
    let rows = [];
    if (data.kind === 'line') {
      head = `<tr><th scope="col">Time</th><th scope="col">Value (${esc(unit)})</th></tr>`;
      const points = HB.charts.downsample(data.points, TABLE_ROW_LIMIT);
      rows = points.map(([t, v]) => `<tr><td>${esc(HB.fmtDayTime(t))}</td><td>${esc(HB.formatNumber(v, HB.app.precision(st.entity_id) ?? 2))}</td></tr>`);
    } else if (data.kind === 'bars') {
      head = `<tr><th scope="col">Period</th><th scope="col">Change (${esc(unit)})</th></tr>`;
      const label = periodLabel(data.period);
      rows = data.bars.map((bar) => `<tr><td>${esc(label(bar))}</td><td>${esc(HB.formatNumber(bar.value, 2))}</td></tr>`);
    } else {
      head = '<tr><th scope="col">From</th><th scope="col">State</th><th scope="col">Duration</th></tr>';
      rows = [...data.segments].reverse().slice(0, TABLE_ROW_LIMIT)
        .map((seg) => `<tr><td>${esc(HB.fmtDayTime(seg.from))}</td><td>${esc(seg.label)}</td><td>${esc(HB.fmtDuration(seg.to - seg.from))}</td></tr>`);
    }
    if (!rows.length) return '<p class="chart-empty">No data in this range.</p>';
    return `<div class="table-wrap"><table class="data-table"><thead>${head}</thead><tbody>${rows.join('')}</tbody></table></div>`;
  }

  function logHtml(data) {
    const recent = [...data.segments].reverse().slice(0, LOG_LIMIT);
    if (!recent.length) return '<p class="chart-empty">No changes recorded in this range.</p>';
    return `<ol class="log">${recent.map((seg) => `<li><span>${esc(seg.label)}</span><time>${esc(HB.fmtDayTime(seg.from))}</time></li>`).join('')}</ol>`;
  }

  function renderChart() {
    if (!view || !view.data) return;
    const st = HB.app.states.get(view.id);
    if (!st) return;
    const host = $('detail-chart');
    const { data, mode } = view;
    host.classList.remove('is-loading');
    $('detail-stats').innerHTML = statsFor(data, st, mode)
      .map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`)
      .join('');
    if (view.table) {
      host.onkeydown = null;
      host.removeAttribute('tabindex');
      host.innerHTML = tableHtml(data, st, mode);
      return;
    }
    const name = st.attributes.friendly_name || view.id;
    const unit = unitFor(st, mode);
    if (data.kind === 'line') {
      HB.charts.lineChart(host, data.points, { start: data.start, end: data.end, unit, precision: HB.app.precision(view.id), label: name });
    } else if (data.kind === 'bars') {
      HB.charts.barChart(host, data.bars, { start: data.start, end: data.end, unit, label: name, periodLabel: periodLabel(data.period) });
    } else if (data.kind === 'timeline') {
      HB.charts.timeline(host, data.segments, { start: data.start, end: data.end, label: name });
      host.insertAdjacentHTML('beforeend', logHtml(data));
    } else {
      host.innerHTML = logHtml(data);
    }
  }

  async function load() {
    const current = view;
    const st = HB.app.states.get(current.id);
    if (!st) return;
    const range = RANGES.find((r) => r.id === current.range);
    $('detail-chart').classList.add('is-loading');
    try {
      const data = await loadData(st, current.mode, range);
      if (view !== current) return;
      current.data = data;
      renderChart();
    } catch (err) {
      if (view !== current) return;
      $('detail-chart').classList.remove('is-loading');
      $('detail-chart').innerHTML = `<p class="chart-empty">Could not load history: ${esc(err.message)}</p>`;
    }
  }

  function nowHtml(st) {
    const domain = HB.domainOf(st.entity_id);
    const a = st.attributes;
    let value = HB.stateLabel(st);
    let unit = '';
    if (domain === 'sensor' && HB.isNumeric(st.state)) {
      value = HB.formatNumber(st.state, HB.app.precision(st.entity_id));
      unit = a.unit_of_measurement || '';
    } else if (domain === 'sensor' && a.device_class === 'timestamp' && Number.isFinite(Date.parse(st.state))) {
      value = HB.fmtDayTime(Date.parse(st.state));
    } else if (domain === 'climate' && Number.isFinite(a.current_temperature)) {
      value = HB.formatNumber(a.current_temperature, 1);
      unit = HB.app.units().temperature || '';
    } else if (domain === 'weather' && Number.isFinite(a.temperature)) {
      value = HB.formatNumber(a.temperature, 1);
      unit = a.temperature_unit || '';
    } else if (domain === 'scene' && Number.isFinite(Date.parse(st.state))) {
      value = `Last on ${HB.fmtDayTime(Date.parse(st.state))}`;
    }
    const changed = Number.isFinite(st.last_changed) ? `Changed ${HB.fmtAgo(st.last_changed)} · ${HB.fmtDayTime(st.last_changed)}` : '';
    return `<div class="detail__value">${esc(value)}<span class="t-unit">${esc(unit)}</span></div><div class="detail__changed">${esc(changed)}</div>`;
  }

  function button(action, label, { arg = '', pressed = null, icon = '', disabled = false, tone = '' } = {}) {
    const pressedAttr = pressed == null ? '' : ` aria-pressed="${pressed}"`;
    return `<button class="btn${tone ? ` btn--${tone}` : ''}" type="button" data-action="${action}" data-id="${esc(view.id)}" data-arg="${esc(arg)}"${pressedAttr}${disabled ? ' disabled' : ''}>${icon ? HB.icon(icon) : ''}<span>${esc(label)}</span></button>`;
  }

  function slider(id, label, value, action) {
    return (
      `<label class="slider" for="${id}"><span>${esc(label)}</span><output id="${id}-out" for="${id}">${value}%</output></label>` +
      `<input class="range" id="${id}" type="range" min="1" max="100" step="1" value="${value}" data-action="${action}" data-id="${esc(view.id)}">`
    );
  }

  function controlsHtml(st) {
    const domain = HB.domainOf(st.entity_id);
    const a = st.attributes;
    const offline = HB.isOffline(st);
    const features = a.supported_features || 0;
    if (offline) return '<p class="detail__note">This device is unavailable, so it cannot be controlled right now.</p>';
    if (HB.TOGGLE_DOMAINS.has(domain)) {
      const on = st.state === 'on';
      let html = `<div class="btn-row">${button('toggle', on ? 'Turn off' : 'Turn on', { icon: 'power', tone: on ? '' : 'primary' })}</div>`;
      const modes = a.supported_color_modes || [];
      const dimmable = domain === 'light' && (Number.isFinite(a.brightness) || modes.some((mode) => mode !== 'onoff'));
      if (dimmable) html += slider('ctl-brightness', 'Brightness', Number.isFinite(a.brightness) ? Math.max(1, Math.round((a.brightness / 255) * 100)) : 100, 'brightness');
      if (domain === 'fan' && features & FAN_SET_SPEED) html += slider('ctl-fan', 'Speed', a.percentage || 50, 'fan-speed');
      return html;
    }
    if (domain === 'climate') {
      const single = Number.isFinite(a.temperature);
      const step = a.target_temp_step || 0.5;
      const modes = (a.hvac_modes || []).map((mode) => button('hvac-mode', HB.stateLabel({ entity_id: st.entity_id, state: mode, attributes: {} }), { arg: mode, pressed: st.state === mode })).join('');
      return (
        `<div class="stepper">${button('temp-step', 'Lower', { arg: -step, icon: 'minus', disabled: !single })}` +
        `<div class="stepper__value"><span>Target</span><strong>${single ? esc(HB.formatNumber(a.temperature, 1)) : '—'}${esc(HB.app.units().temperature || '')}</strong></div>` +
        `${button('temp-step', 'Raise', { arg: step, icon: 'plus', disabled: !single })}</div>` +
        (modes ? `<div class="btn-row btn-row--wrap" role="group" aria-label="Mode">${modes}</div>` : '')
      );
    }
    if (domain === 'cover') {
      let html = `<div class="btn-row">${button('cover-open', 'Open', { icon: 'chevronUp' })}${button('cover-stop', 'Stop', { icon: 'stop' })}${button('cover-close', 'Close', { icon: 'chevronDown' })}</div>`;
      if (features & COVER_SET_POSITION) html += slider('ctl-position', 'Position', a.current_position ?? 0, 'cover-position');
      return html;
    }
    if (domain === 'lock') {
      if (view.confirmUnlock) {
        return `<p class="detail__note">Unlock ${esc(a.friendly_name || st.entity_id)}?</p><div class="btn-row">${button('lock-confirm', 'Yes, unlock', { icon: 'unlock', tone: 'danger' })}${button('lock-cancel', 'Cancel')}</div>`;
      }
      return st.state === 'locked'
        ? `<div class="btn-row">${button('lock-ask', 'Unlock', { icon: 'unlock' })}</div>`
        : `<div class="btn-row">${button('lock', 'Lock', { icon: 'lock', tone: 'primary' })}</div>`;
    }
    if (domain === 'media_player' && st.state !== 'off') {
      const playing = st.state === 'playing';
      let html = `<div class="btn-row">${button('media-prev', 'Previous', { icon: 'prev' })}${button('media-toggle', playing ? 'Pause' : 'Play', { icon: playing ? 'pause' : 'play', tone: 'primary' })}${button('media-next', 'Next', { icon: 'next' })}</div>`;
      if (features & MEDIA_VOLUME_SET && Number.isFinite(a.volume_level)) html += slider('ctl-volume', 'Volume', Math.max(1, Math.round(a.volume_level * 100)), 'volume');
      return html;
    }
    if (domain === 'scene') return `<div class="btn-row">${button('scene', 'Activate', { icon: 'sparkle', tone: 'primary' })}</div>`;
    if (domain === 'weather') return forecastTable(st);
    return '';
  }

  function forecastTable(st) {
    const forecast = HB.app.forecast(st.entity_id);
    if (!forecast.length) return '';
    const rows = forecast.map((f) => {
      const t = Date.parse(f.datetime);
      return `<tr><td>${esc(HB.fmtDayDate(t))}</td><td>${HB.icon(HB.weatherIcon(f.condition), 'ic--inline')}${esc(HB.conditionLabel(f.condition))}</td>` +
        `<td>${esc(HB.formatNumber(f.temperature, 0))}° / ${esc(Number.isFinite(f.templow) ? `${HB.formatNumber(f.templow, 0)}°` : '—')}</td>` +
        `<td>${Number.isFinite(f.precipitation_probability) ? `${esc(f.precipitation_probability)}%` : '—'}</td></tr>`;
    });
    return `<div class="table-wrap"><table class="data-table"><thead><tr><th scope="col">Day</th><th scope="col">Conditions</th><th scope="col">High / low</th><th scope="col">Rain</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }

  function attributesHtml(st) {
    const entries = Object.entries(st.attributes).filter(([key]) => key !== 'entity_picture');
    const value = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v));
    return (
      `<summary>All attributes <span>${entries.length}</span></summary><div class="table-wrap"><table class="data-table data-table--kv"><tbody>` +
      entries.map(([key, v]) => `<tr><th scope="row">${esc(key)}</th><td>${esc(value(v))}</td></tr>`).join('') +
      '</tbody></table></div>'
    );
  }

  function renderHeader(st) {
    const area = HB.app.areaName(st.entity_id);
    $('detail-icon').innerHTML = HB.icon(HB.entityIconName(st));
    $('detail-eyebrow').textContent = [area, HB.humanize(HB.domainOf(st.entity_id))].filter(Boolean).join(' · ');
    $('detail-title').textContent = st.attributes.friendly_name || st.entity_id;
    $('detail-id').textContent = st.entity_id;
  }

  function renderLive() {
    const st = HB.app.states.get(view.id);
    if (!st) return;
    renderHeader(st);
    $('detail-now').innerHTML = nowHtml(st);
    const controls = $('detail-controls');
    const busy = controls.contains(document.activeElement) && document.activeElement.type === 'range';
    if (!busy) {
      const focusedAction = controls.contains(document.activeElement) ? document.activeElement.dataset.action : null;
      controls.innerHTML = controlsHtml(st);
      controls.hidden = !controls.innerHTML;
      if (focusedAction) controls.querySelector(`[data-action="${focusedAction}"]`)?.focus();
    }
    const attrs = $('detail-attrs');
    const open = attrs.open;
    attrs.innerHTML = attributesHtml(st);
    attrs.open = open;
  }

  function renderToolbar() {
    $('detail-ranges').innerHTML = RANGES.map(
      (range) => `<button class="seg" type="button" data-action="range" data-arg="${range.id}" aria-pressed="${range.id === view.range}">${range.label}</button>`,
    ).join('');
    $('detail-view').innerHTML =
      `<button class="seg" type="button" data-action="view" data-arg="chart" aria-pressed="${!view.table}">Chart</button>` +
      `<button class="seg" type="button" data-action="view" data-arg="table" aria-pressed="${view.table}">Table</button>`;
  }

  HB.detail = {
    /** Opens the detail view for an entity. */
    open(id) {
      const st = HB.app.states.get(id);
      if (!st) return;
      dialog = dialog || $('detail');
      view = { id, range: DEFAULT_RANGE, table: false, data: null, mode: chartMode(st), confirmUnlock: false, opener: document.activeElement };
      $('detail-chart').replaceChildren();
      $('detail-stats').replaceChildren();
      $('detail-attrs').open = false;
      renderToolbar();
      renderLive();
      if (!dialog.open) dialog.showModal();
      $('detail-panel').scrollTop = 0;
      load();
    },

    close() {
      if (dialog && dialog.open) dialog.close();
    },

    isOpen: () => Boolean(view && dialog && dialog.open),

    currentId: () => (view ? view.id : null),

    /** Re-renders live parts (value, controls, attributes) after a state change. */
    refresh() {
      if (HB.detail.isOpen()) renderLive();
    },

    /** Handles toolbar and confirm actions that belong to the detail view; returns true if handled. */
    handle(action, arg) {
      if (!view) return false;
      if (action === 'range') {
        view.range = arg;
        renderToolbar();
        load();
      } else if (action === 'view') {
        view.table = arg === 'table';
        renderToolbar();
        renderChart();
      } else if (action === 'lock-ask' || action === 'lock-cancel') {
        view.confirmUnlock = action === 'lock-ask';
        renderLive();
        $('detail-controls').querySelector('button')?.focus();
      } else if (action === 'close-detail') {
        HB.detail.close();
      } else {
        return false;
      }
      return true;
    },

    resetConfirm() {
      if (view) view.confirmUnlock = false;
    },

    init() {
      dialog = $('detail');
      dialog.addEventListener('close', () => {
        const opener = view && view.opener;
        view = null;
        if (opener && document.contains(opener)) opener.focus();
      });
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) HB.detail.close();
      });
      window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (HB.detail.isOpen() && !view.table) renderChart();
        }, 150);
      });
    },
  };
})(window.HB = window.HB || {});
