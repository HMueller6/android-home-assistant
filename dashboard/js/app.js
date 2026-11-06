/* Habitat — application shell: boot, state stream, rendering, header, settings and actions. */
(function (HB) {
  'use strict';

  const { SECOND, MINUTE, HOUR } = HB.MS;
  const SETTINGS_KEY = 'habitat.settings';
  const CONFIG_FILE = 'habitat.config.json';
  const ACCENTS = {
    cyan: { label: 'Cyan', hex: '#38d9f5' },
    ice: { label: 'Ice', hex: '#8ab8ff' },
    violet: { label: 'Violet', hex: '#b19cff' },
    mint: { label: 'Mint', hex: '#41e6b0' },
    rose: { label: 'Rose', hex: '#ff7eb6' },
  };
  const DEFAULT_ACCENT = 'cyan';
  const DEFAULT_SETTINGS = { accent: null, density: 'comfortable', showUnavailable: false, area: 'all', keepAwake: false };
  const DEFAULT_HISTORY_HOURS = 24;
  const HISTORY_REFRESH_MS = 10 * MINUTE;
  const META_REFRESH_MS = 30 * MINUTE;
  const RELATIVE_TICK_MS = 30 * SECOND;
  const CAMERA_TICK_MS = 10 * SECOND;
  const HISTORY_CHUNK = 50;
  const HISTORY_LIMIT = 160;
  const SERIES_LIMIT = 5000;
  const PENDING_TIMEOUT_MS = 6 * SECOND;
  const TARGET_DEBOUNCE_MS = 500;
  const BOOT_ANIMATION_MS = 1600;
  const IDLE_CURSOR_MS = 4 * SECOND;
  const LONG_PRESS_MS = 550;
  const RETRY_MIN_MS = 5 * SECOND;
  const RETRY_MAX_MS = 60 * SECOND;
  const TOAST_MS = 3200;
  const STATUS = {
    connecting: ['Connecting', 'warning'],
    connected: ['Live', 'good'],
    reconnecting: ['Reconnecting', 'warning'],
    closed: ['Offline', 'critical'],
    demo: ['Demo', 'accent'],
  };

  const $ = (id) => document.getElementById(id);

  const app = (HB.app = {
    backend: null,
    states: new Map(),
    registry: HB.emptyRegistry(),
    haConfig: {},
    config: {},
    filters: { include: [], exclude: [] },
    settings: { ...DEFAULT_SETTINGS, ...HB.storage.get(SETTINGS_KEY, {}) },
    history: new Map(),
    forecasts: new Map(),
    pending: new Map(),
    targets: new Map(),
    tiles: new Map(),
    sections: new Map(),
    changed: new Set(),
    layout: null,
    layoutSignature: '',
    tabsSignature: '',
    derived: null,
    forecastFor: null,
    awaitingSnapshot: true,
    status: 'connecting',
    wakeLock: null,
    timers: [],
    units: () => app.haConfig.unit_system || {},
    precision: (id) => app.registry.entities.get(id)?.precision ?? null,
    areaName: (id) => {
      const areaId = app.registry.entities.get(id)?.areaId;
      return areaId ? app.registry.areaNames.get(areaId) || '' : '';
    },
    forecast: (id) => app.forecasts.get(id) || app.states.get(id)?.attributes.forecast || [],
  });

  function historyHours() {
    return Number(app.config.historyHours) > 0 ? Number(app.config.historyHours) : DEFAULT_HISTORY_HOURS;
  }

  function context(now = Date.now()) {
    return {
      states: app.states, registry: app.registry, config: app.config, filters: app.filters, settings: app.settings,
      derived: app.derived, history: app.history, forecast: app.forecasts, hassUrl: app.backend?.hassUrl || '',
      units: app.units(), now, window: { start: now - historyHours() * HOUR, end: now }, pending: app.pending,
    };
  }

  // ---- Settings -------------------------------------------------------------------------------

  function saveSettings() {
    HB.storage.set(SETTINGS_KEY, app.settings);
  }

  function accentHex() {
    if (app.settings.accent && ACCENTS[app.settings.accent]) return ACCENTS[app.settings.accent].hex;
    if (HB.hexToRgb(app.config.accent || '')) return app.config.accent;
    return ACCENTS[DEFAULT_ACCENT].hex;
  }

  function applySettings() {
    const root = document.documentElement;
    const hex = accentHex();
    root.style.setProperty('--accent', hex);
    root.style.setProperty('--accent-rgb', HB.hexToRgb(hex));
    root.dataset.density = app.settings.density === 'compact' ? 'compact' : 'comfortable';
  }

  function updateSetting(key, value) {
    app.settings[key] = value;
    saveSettings();
    applySettings();
    renderEverything();
  }

  // ---- State stream ---------------------------------------------------------------------------

  function fromCompressed(id, c) {
    const changed = HB.toMs(c.lc);
    return { entity_id: id, state: c.s, attributes: c.a || {}, last_changed: changed, last_updated: c.lu ? HB.toMs(c.lu) : changed };
  }

  function applyDiff(id, diff) {
    const current = app.states.get(id);
    if (!current) return;
    const plus = diff['+'];
    const minus = diff['-'];
    const next = { ...current };
    if ((plus && plus.a) || (minus && minus.a)) next.attributes = { ...current.attributes };
    if (plus) {
      if (plus.s !== undefined) next.state = plus.s;
      if (plus.lc) next.last_changed = next.last_updated = HB.toMs(plus.lc);
      else if (plus.lu) next.last_updated = HB.toMs(plus.lu);
      if (plus.a) Object.assign(next.attributes, plus.a);
    }
    if (minus && minus.a) minus.a.forEach((key) => delete next.attributes[key]);
    app.states.set(id, next);
    clearPending(id);
    if (plus && plus.s !== undefined) appendHistory(id, next);
  }

  /** Handles subscribe_entities messages: a = added (full), c = changed (diff), r = removed. */
  function onEntities(message) {
    if (message.a && app.awaitingSnapshot) {
      app.states = new Map();
      app.awaitingSnapshot = false;
    }
    if (message.a) {
      for (const [id, c] of Object.entries(message.a)) {
        app.states.set(id, fromCompressed(id, c));
        app.changed.add(id);
      }
    }
    if (message.r) message.r.forEach((id) => app.states.delete(id));
    if (message.c) {
      for (const [id, diff] of Object.entries(message.c)) {
        applyDiff(id, diff);
        app.changed.add(id);
      }
    }
    scheduleRender();
  }

  function appendHistory(id, st) {
    const series = app.history.get(id);
    if (!series || !HB.isNumeric(st.state)) return;
    series.push([st.last_updated, Number(st.state)]);
    const cutoff = Date.now() - (historyHours() + 1) * HOUR;
    if (series.length > SERIES_LIMIT || series[0][0] < cutoff - HOUR) {
      const kept = series.filter(([t]) => t >= cutoff);
      app.history.set(id, kept.slice(-SERIES_LIMIT));
    }
  }

  // ---- Loading --------------------------------------------------------------------------------

  async function loadConfigFile() {
    if (!/^https?:$/.test(location.protocol)) return {};
    try {
      const response = await fetch(CONFIG_FILE, { cache: 'no-store' });
      if (!response.ok) return {};
      const json = await response.json();
      return json && typeof json === 'object' ? json : {};
    } catch (err) {
      console.warn(`Ignoring ${CONFIG_FILE}: ${err.message}`);
      return {};
    }
  }

  async function loadMeta() {
    const backend = app.backend;
    const request = (type) => backend.send({ type });
    const [config, areas, entities, devices] = await Promise.allSettled([
      request('get_config'),
      request('config/area_registry/list'),
      request('config/entity_registry/list_for_display'),
      request('config/device_registry/list'),
    ]);
    if (backend !== app.backend) return;
    const value = (result) => (result.status === 'fulfilled' ? result.value : null);
    if (value(config)) app.haConfig = value(config);
    if (value(areas) || value(entities) || value(devices)) {
      app.registry = HB.buildRegistry({ areas: value(areas), entities: value(entities), devices: value(devices) });
      app.layoutSignature = '';
    }
    renderEverything();
  }

  async function loadForecast() {
    const id = app.derived && app.derived.weatherId;
    if (!id || !app.backend) return;
    try {
      const result = await app.backend.send({
        type: 'call_service', domain: 'weather', service: 'get_forecasts',
        service_data: { type: 'daily' }, target: { entity_id: id }, return_response: true,
      });
      const forecast = result && result.response && result.response[id] && result.response[id].forecast;
      if (forecast && forecast.length) app.forecasts.set(id, forecast);
    } catch (err) {
      console.info(`No daily forecast for ${id}: ${err.message}`);
    }
    renderEverything();
  }

  function historyIdsFor(layout) {
    const ids = [];
    for (const section of layout.sections) {
      for (const item of section.items) if (item.kind === 'stat') ids.push(item.id);
    }
    if (app.derived.mainPowerId) ids.unshift(app.derived.mainPowerId);
    return ids.filter((id) => HB.isNumeric(app.states.get(id)?.state)).slice(0, HISTORY_LIMIT);
  }

  async function loadHistory(ids) {
    const backend = app.backend;
    const end = Date.now();
    const start = end - historyHours() * HOUR;
    for (let i = 0; i < ids.length; i += HISTORY_CHUNK) {
      const chunk = ids.slice(i, i + HISTORY_CHUNK);
      try {
        const result = await backend.send({
          type: 'history/history_during_period',
          start_time: new Date(start).toISOString(),
          end_time: new Date(end).toISOString(),
          entity_ids: chunk,
          minimal_response: true,
          no_attributes: true,
          significant_changes_only: false,
        });
        if (backend !== app.backend) return;
        for (const id of chunk) {
          const points = HB.numericPoints(result[id]);
          const st = app.states.get(id);
          if (st && HB.isNumeric(st.state)) points.push([Math.max(end, st.last_updated), Number(st.state)]);
          app.history.set(id, points);
        }
      } catch (err) {
        console.warn(`History unavailable: ${err.message}`);
        return;
      }
      renderEverything();
    }
  }

  function syncHistory(layout) {
    const missing = historyIdsFor(layout).filter((id) => !app.history.has(id));
    if (missing.length) loadHistory(missing);
  }

  function refreshHistory() {
    if (app.layout) loadHistory(historyIdsFor(app.layout));
  }

  // ---- Rendering ------------------------------------------------------------------------------

  let renderQueued = false;
  let renderAll = true;

  /**
   * Queues a render on the next frame. By default only tiles whose entity changed are redrawn;
   * `all` redraws every tile (relative times, settings, registry, history or forecast changes).
   */
  function scheduleRender(all = false) {
    if (all) renderAll = true;
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(render);
  }
  const renderEverything = () => scheduleRender(true);

  const GRID_VARIANT = { scenes: 'grid--chips', batteries: 'grid--rows' };

  function sectionRecord(section) {
    let rec = app.sections.get(section.id);
    if (rec) return rec;
    const el = document.createElement('section');
    el.className = `sec sec--${section.id}`;
    el.setAttribute('aria-labelledby', `sec-${section.id}`);
    el.innerHTML =
      `<header class="sec__head"><h2 class="sec__title" id="sec-${section.id}">${HB.esc(section.title)}</h2>` +
      '<span class="sec__count"></span><span class="sec__rule" aria-hidden="true"></span><span class="sec__summary"></span></header>' +
      `<div class="grid ${GRID_VARIANT[section.id] || 'grid--tiles'}"></div>`;
    rec = { el, grid: el.lastElementChild, count: el.querySelector('.sec__count'), summary: el.querySelector('.sec__summary'), countText: '', summaryText: '' };
    app.sections.set(section.id, rec);
    return rec;
  }

  function tileRecord(item) {
    let rec = app.tiles.get(item.id);
    if (rec && rec.kind === item.kind && rec.size === item.size) return rec;
    if (rec) rec.el.remove();
    const el = document.createElement('div');
    el.dataset.id = item.id;
    const hit = document.createElement('button');
    hit.type = 'button';
    hit.className = 'tile__hit';
    hit.dataset.action = 'primary';
    const body = document.createElement('div');
    body.className = 'tile__body';
    el.append(hit, body);
    rec = { el, hit, body, kind: item.kind, size: item.size, html: null, cls: null, glow: null, label: null, primary: undefined, target: null };
    app.tiles.set(item.id, rec);
    return rec;
  }

  function mountLayout(layout) {
    const root = $('sections');
    const keepTiles = new Set();
    const keepSections = new Set();
    let index = 0;
    for (const section of layout.sections) {
      const rec = sectionRecord(section);
      keepSections.add(section.id);
      root.appendChild(rec.el);
      for (const item of section.items) {
        const tile = tileRecord(item);
        tile.el.style.setProperty('--i', String(index % 24));
        index += 1;
        rec.grid.appendChild(tile.el);
        keepTiles.add(item.id);
      }
    }
    for (const [id, rec] of app.tiles) {
      if (!keepTiles.has(id)) {
        rec.el.remove();
        app.tiles.delete(id);
      }
    }
    for (const [id, rec] of app.sections) {
      if (!keepSections.has(id)) {
        rec.el.remove();
        app.sections.delete(id);
      }
    }
    $('empty').hidden = layout.sections.length > 0;
  }

  function replaceBody(rec, html) {
    const active = document.activeElement;
    let restore = null;
    if (active && active !== rec.hit && rec.el.contains(active) && active.dataset.action) {
      restore = { action: active.dataset.action, arg: active.dataset.arg || '' };
    }
    rec.body.innerHTML = html;
    if (restore) {
      const candidates = rec.body.querySelectorAll(`[data-action="${restore.action}"]`);
      const match = Array.from(candidates).find((el) => (el.dataset.arg || '') === restore.arg);
      if (match && !match.disabled) match.focus();
      else rec.hit.focus();
    }
  }

  function updateTile(item, ctx) {
    const rec = app.tiles.get(item.id);
    let out;
    try {
      out = HB.tiles.render(item, ctx);
    } catch (err) {
      console.error(`Could not render ${item.id}`, err);
      out = { cls: 'is-offline', label: item.id, primary: 'detail', html: `<div class="t-name">${HB.esc(item.id)}</div><p class="t-note">This tile could not be drawn.</p>` };
    }
    const cls = `tile size-${item.size} k-${item.kind}${out.cls ? ` ${out.cls}` : ''}${app.pending.has(item.id) ? ' is-pending' : ''}`;
    if (cls !== rec.cls) {
      rec.el.className = cls;
      rec.cls = cls;
    }
    if (out.glow !== rec.glow) {
      if (out.glow) rec.el.style.setProperty('--glow-rgb', out.glow);
      else rec.el.style.removeProperty('--glow-rgb');
      rec.glow = out.glow;
    }
    if (out.primary !== rec.primary) {
      rec.hit.hidden = !out.primary;
      rec.primary = out.primary;
    }
    rec.target = out.target || item.id;
    if (out.label !== rec.label) {
      rec.hit.setAttribute('aria-label', out.label);
      rec.label = out.label;
    }
    if (out.html !== rec.html) {
      replaceBody(rec, out.html);
      rec.html = out.html;
    }
  }

  function updateSectionHead(section, ctx) {
    const rec = app.sections.get(section.id);
    const count = String(section.items.length).padStart(2, '0');
    const summary = HB.sectionSummary(section, app.states, ctx);
    if (count !== rec.countText) {
      rec.count.textContent = count;
      rec.countText = count;
    }
    if (summary !== rec.summaryText) {
      rec.summary.textContent = summary;
      rec.summaryText = summary;
    }
  }

  function renderTabs(layout) {
    const areas = Array.from(layout.areasWithTiles)
      .map((id) => [id, app.registry.areaNames.get(id) || HB.humanize(id)])
      .sort((a, b) => a[1].localeCompare(b[1]));
    if (app.settings.area !== 'all' && !layout.areasWithTiles.has(app.settings.area) && app.registry.areaNames.size) {
      app.settings.area = 'all';
      saveSettings();
      renderEverything();
    }
    const signature = `${app.settings.area}|${areas.map(([id, name]) => `${id}=${name}`).join(',')}`;
    if (signature === app.tabsSignature) return;
    app.tabsSignature = signature;
    const nav = $('area-tabs');
    nav.hidden = areas.length < 2;
    const tab = (id, name) =>
      `<button class="tab" type="button" data-action="area" data-arg="${HB.esc(id)}" aria-pressed="${app.settings.area === id}">${HB.esc(name)}</button>`;
    nav.innerHTML = tab('all', 'All rooms') + areas.map(([id, name]) => tab(id, name)).join('');
  }

  function attentionItems() {
    const d = app.derived;
    const name = (id) => app.states.get(id)?.attributes.friendly_name || id;
    return [
      ...d.alerts.map((id) => ({ id, tone: 'critical', text: name(id), detail: HB.stateLabel(app.states.get(id)) })),
      ...d.lowBatteries.map((id) => ({ id, tone: 'warning', text: name(id), detail: `Battery ${app.states.get(id).state}%` })),
      ...d.updates.map((id) => ({ id, tone: 'info', text: name(id), detail: 'Update available' })),
    ];
  }

  function renderHeader() {
    const title = app.config.title || app.haConfig.location_name || 'Home';
    if ($('hud-site').textContent !== title) {
      $('hud-site').textContent = title;
      document.title = `${title} · Habitat`;
    }
    const [statusText, statusTone] = STATUS[app.status] || STATUS.connecting;
    const link = $('hud-link');
    link.className = `pill pill--${statusTone}`;
    link.lastElementChild.textContent = statusText;
    const d = app.derived;
    const pill = $('hud-attention');
    let text = 'All clear';
    let tone = 'good';
    let icon = 'shieldCheck';
    if (d.alerts.length) {
      text = `${d.alerts.length} alert${d.alerts.length > 1 ? 's' : ''}`;
      tone = 'critical';
      icon = 'alert';
    } else if (d.lowBatteries.length) {
      text = `${d.lowBatteries.length} low batter${d.lowBatteries.length > 1 ? 'ies' : 'y'}`;
      tone = 'warning';
      icon = 'battery';
    }
    const html = `${HB.icon(icon)}<span>${HB.esc(text)}</span>`;
    if (pill.innerHTML !== html) pill.innerHTML = html;
    pill.className = `pill pill--${tone} pill--button`;
    if ($('attention').open) renderAttention();
  }

  function render() {
    renderQueued = false;
    if (!app.backend || (app.awaitingSnapshot && !app.states.size)) return;
    const ctx = context();
    app.derived = HB.derive(app.states, ctx);
    ctx.derived = app.derived;
    const layout = HB.buildLayout(app.states, ctx);
    app.layout = layout;
    let all = renderAll;
    renderAll = false;
    const signature = layout.sections.map((s) => `${s.id}:${s.items.map((i) => `${i.id}/${i.kind}/${i.size}`).join(',')}`).join('|');
    if (signature !== app.layoutSignature) {
      app.layoutSignature = signature;
      mountLayout(layout);
      syncHistory(layout);
      all = true;
    }
    for (const section of layout.sections) {
      updateSectionHead(section, ctx);
      for (const item of section.items) {
        if (all || item.id.startsWith('@') || app.changed.has(item.id)) updateTile(item, ctx);
      }
    }
    renderTabs(layout);
    renderHeader();
    if (HB.detail.isOpen() && app.changed.has(HB.detail.currentId())) HB.detail.refresh();
    app.changed.clear();
    if (app.derived.weatherId && app.derived.weatherId !== app.forecastFor) {
      app.forecastFor = app.derived.weatherId;
      loadForecast();
    }
    document.body.classList.add('is-ready');
  }

  // ---- Clock ----------------------------------------------------------------------------------

  function tickClock() {
    const now = Date.now();
    $('hud-clock').textContent = HB.fmtTime(now);
    $('hud-seconds').textContent = String(new Date(now).getSeconds()).padStart(2, '0');
    const date = HB.fmtLongDate(now);
    if ($('hud-date').textContent !== date) $('hud-date').textContent = date;
  }

  // ---- Actions --------------------------------------------------------------------------------

  function toast(message, tone = '') {
    const el = document.createElement('div');
    el.className = `toast${tone ? ` toast--${tone}` : ''}`;
    el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    el.textContent = message;
    $('toasts').appendChild(el);
    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 300);
    }, TOAST_MS);
  }
  HB.toast = toast;

  function markPending(id) {
    clearTimeout(app.pending.get(id));
    app.pending.set(id, setTimeout(() => clearPending(id), PENDING_TIMEOUT_MS));
    app.changed.add(id);
    scheduleRender();
  }

  function clearPending(id) {
    if (!app.pending.has(id)) return;
    clearTimeout(app.pending.get(id));
    app.pending.delete(id);
    app.changed.add(id);
    scheduleRender();
  }

  function call(domain, service, data, entityId) {
    const message = { type: 'call_service', domain, service, service_data: data || {} };
    if (entityId) message.target = { entity_id: entityId };
    return app.backend.send(message);
  }

  async function run(id, domain, service, data, done) {
    markPending(id);
    try {
      await call(domain, service, data, id);
      if (done) toast(done);
    } catch (err) {
      clearPending(id);
      toast(`That didn't work: ${err.message}`, 'error');
    }
  }

  function friendly(id) {
    return app.states.get(id)?.attributes.friendly_name || id;
  }

  function toggle(id) {
    const domain = HB.domainOf(id);
    return run(id, HB.TOGGLE_DOMAINS.has(domain) ? domain : 'homeassistant', 'toggle', {});
  }

  /** Raises or lowers a thermostat target; repeated taps accumulate and send once. */
  function stepTemperature(id, delta) {
    const st = app.states.get(id);
    if (!st || !Number.isFinite(st.attributes.temperature)) return;
    const a = st.attributes;
    const base = app.targets.has(id) ? app.targets.get(id).value : a.temperature;
    const value = HB.clamp(Math.round((base + delta) * 10) / 10, a.min_temp ?? 7, a.max_temp ?? 35);
    const previous = app.targets.get(id);
    if (previous) clearTimeout(previous.timer);
    app.states.set(id, { ...st, attributes: { ...a, temperature: value } });
    app.changed.add(id);
    const timer = setTimeout(() => {
      app.targets.delete(id);
      run(id, 'climate', 'set_temperature', { temperature: value });
    }, TARGET_DEBOUNCE_MS);
    app.targets.set(id, { value, timer });
    scheduleRender();
  }

  function setArea(area) {
    updateSetting('area', area || 'all');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
      return;
    }
    const request = document.documentElement.requestFullscreen;
    if (!request) {
      toast('Full screen is not available in this browser.', 'error');
      return;
    }
    request.call(document.documentElement).catch(() => toast('Full screen is not available here.', 'error'));
  }

  async function requestWakeLock(announce) {
    try {
      app.wakeLock = await navigator.wakeLock.request('screen');
      app.wakeLock.addEventListener('release', () => {
        app.wakeLock = null;
      });
      if (announce) toast('The screen will stay on while Habitat is open.');
    } catch (err) {
      if (announce) toast(`The screen can't be kept on: ${err.message}`, 'error');
    }
  }

  async function setKeepAwake(on) {
    if (on && !('wakeLock' in navigator)) {
      toast('Keeping the screen on needs HTTPS or a kiosk browser.', 'error');
      on = false;
    }
    app.settings.keepAwake = on;
    saveSettings();
    if (on) await requestWakeLock(true);
    else if (app.wakeLock) {
      await app.wakeLock.release();
      app.wakeLock = null;
    }
    $('hud-wake').setAttribute('aria-pressed', String(Boolean(app.settings.keepAwake)));
    $('set-awake').checked = Boolean(app.settings.keepAwake);
  }

  function renderAttention() {
    const items = attentionItems();
    $('attention-list').innerHTML = items.length
      ? items.map((item) =>
        `<li><button class="att att--${item.tone}" type="button" data-action="attention-open" data-id="${HB.esc(item.id)}">` +
        `${HB.icon(item.tone === 'critical' ? 'alert' : item.tone === 'warning' ? 'battery' : 'update')}` +
        `<span>${HB.esc(item.text)}</span><small>${HB.esc(item.detail)}</small></button></li>`).join('')
      : `<li class="att-empty">${HB.icon('shieldCheck')}<span>Nothing needs attention. No alerts, no batteries below ${HB.BATTERY.LOW}%.</span></li>`;
  }

  function openSettings() {
    const accent = app.settings.accent || (HB.hexToRgb(app.config.accent || '') ? null : DEFAULT_ACCENT);
    document.querySelectorAll('input[name="accent"]').forEach((input) => {
      input.checked = input.value === accent;
    });
    document.querySelectorAll('input[name="density"]').forEach((input) => {
      input.checked = input.value === (app.settings.density === 'compact' ? 'compact' : 'comfortable');
    });
    $('set-unavailable').checked = Boolean(app.settings.showUnavailable);
    $('set-awake').checked = Boolean(app.settings.keepAwake);
    const info = app.backend ? app.backend.describe() : { mode: 'Not connected', url: '', version: '' };
    $('set-connection').innerHTML = [
      ['Connection', info.mode], ['Address', info.url], ['Home Assistant', info.version || '—'], ['Habitat', HB.VERSION],
    ].map(([k, v]) => `<div><dt>${HB.esc(k)}</dt><dd>${HB.esc(v || '—')}</dd></div>`).join('');
    $('set-signout').hidden = !(app.backend && app.backend.signOut);
    $('set-connect').hidden = !(app.backend && app.backend.kind === 'demo') || Boolean(HB.forceDemo);
    $('settings').showModal();
  }

  async function signOut() {
    if (app.backend && app.backend.signOut) await app.backend.signOut();
    location.replace(location.pathname);
  }

  function handleAction(action, el) {
    const id = el.dataset.id || el.closest('[data-id]')?.dataset.id;
    const arg = el.dataset.arg;
    if (HB.detail.handle(action, arg)) return;
    switch (action) {
      case 'primary': {
        const rec = app.tiles.get(id);
        if (!rec) return;
        if (rec.primary === 'toggle') toggle(id);
        else if (rec.primary === 'scene') run(id, 'scene', 'turn_on', {}, `${friendly(id)} activated`);
        else HB.detail.open(rec.target);
        break;
      }
      case 'detail': HB.detail.open(id); break;
      case 'attention-open': $('attention').close(); HB.detail.open(id); break;
      case 'toggle': toggle(id); break;
      case 'scene': run(id, 'scene', 'turn_on', {}, `${friendly(id)} activated`); break;
      case 'temp-step': stepTemperature(id, Number(arg)); break;
      case 'hvac-mode': run(id, 'climate', 'set_hvac_mode', { hvac_mode: arg }); break;
      case 'cover-open': run(id, 'cover', 'open_cover', {}); break;
      case 'cover-close': run(id, 'cover', 'close_cover', {}); break;
      case 'cover-stop': run(id, 'cover', 'stop_cover', {}); break;
      case 'lock': run(id, 'lock', 'lock', {}); break;
      case 'lock-confirm': HB.detail.resetConfirm(); run(id, 'lock', 'unlock', {}); break;
      case 'media-toggle': run(id, 'media_player', 'media_play_pause', {}); break;
      case 'media-next': run(id, 'media_player', 'media_next_track', {}); break;
      case 'media-prev': run(id, 'media_player', 'media_previous_track', {}); break;
      case 'area': setArea(arg); break;
      case 'fullscreen': toggleFullscreen(); break;
      case 'wake': setKeepAwake(!app.settings.keepAwake); break;
      case 'settings': openSettings(); break;
      case 'attention': renderAttention(); $('attention').showModal(); break;
      case 'close-dialog': el.closest('dialog').close(); break;
      case 'sign-out': signOut(); break;
      case 'connect-real': location.assign(location.pathname); break;
      default: break;
    }
  }

  const SLIDER_SERVICES = {
    brightness: (v) => ['light', 'turn_on', { brightness_pct: v }],
    'fan-speed': (v) => ['fan', 'set_percentage', { percentage: v }],
    volume: (v) => ['media_player', 'volume_set', { volume_level: v / 100 }],
    'cover-position': (v) => ['cover', 'set_cover_position', { position: v }],
  };

  function bindEvents() {
    let pressTimer = null;
    let pressOrigin = null;
    let suppressClick = false;

    document.addEventListener('click', (event) => {
      const el = event.target.closest('[data-action]');
      if (!el || el.disabled || el.matches('input')) return;
      if (suppressClick) {
        suppressClick = false;
        if (el.dataset.action === 'primary') return;
      }
      handleAction(el.dataset.action, el);
    });

    document.addEventListener('pointerdown', (event) => {
      const hit = event.target.closest('.tile__hit');
      if (!hit || event.button !== 0) return;
      pressOrigin = [event.clientX, event.clientY];
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        pressTimer = null;
        suppressClick = true;
        const rec = app.tiles.get(hit.parentElement.dataset.id);
        if (rec && rec.primary) HB.detail.open(rec.target);
      }, LONG_PRESS_MS);
    });
    const cancelPress = () => {
      clearTimeout(pressTimer);
      pressTimer = null;
    };
    document.addEventListener('pointerup', cancelPress);
    document.addEventListener('pointercancel', cancelPress);
    document.addEventListener('pointermove', (event) => {
      if (pressTimer && pressOrigin && Math.hypot(event.clientX - pressOrigin[0], event.clientY - pressOrigin[1]) > 10) cancelPress();
    });
    document.addEventListener('contextmenu', (event) => {
      const hit = event.target.closest('.tile__hit');
      if (!hit) return;
      event.preventDefault();
      if (suppressClick || HB.detail.isOpen()) return;
      const rec = app.tiles.get(hit.parentElement.dataset.id);
      if (rec && rec.primary) HB.detail.open(rec.target);
    });

    document.addEventListener('input', (event) => {
      const el = event.target;
      if (el.matches('input.range')) {
        const output = $(`${el.id}-out`);
        if (output) output.textContent = `${el.value}%`;
      }
    });
    document.addEventListener('change', (event) => {
      const el = event.target;
      if (el.matches('input.range') && SLIDER_SERVICES[el.dataset.action]) {
        const [domain, service, data] = SLIDER_SERVICES[el.dataset.action](Number(el.value));
        run(el.dataset.id, domain, service, data);
      } else if (el.name === 'accent') {
        updateSetting('accent', el.value);
      } else if (el.name === 'density') {
        updateSetting('density', el.value);
      } else if (el.id === 'set-unavailable') {
        updateSetting('showUnavailable', el.checked);
      } else if (el.id === 'set-awake') {
        setKeepAwake(el.checked);
      }
    });

    document.querySelectorAll('dialog.sheet').forEach((dialog) => {
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (app.settings.keepAwake && !app.wakeLock && 'wakeLock' in navigator) requestWakeLock(false);
        renderEverything();
      }
    });

    let idleTimer = null;
    document.addEventListener('mousemove', () => {
      document.body.classList.remove('is-idle');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => document.body.classList.add('is-idle'), IDLE_CURSOR_MS);
    }, { passive: true });

    $('connect-form').addEventListener('submit', submitConnect);
  }

  // ---- Connecting -----------------------------------------------------------------------------

  let retryTimer = null;
  let retryDelay = RETRY_MIN_MS;

  function showConnect({ error = '', url = '', retrying = false } = {}) {
    document.body.classList.add('is-connect');
    $('connect').hidden = false;
    $('connect-error').textContent = error;
    $('connect-error').hidden = !error;
    if (url || !$('connect-url').value) $('connect-url').value = url || HB.defaultHassUrl();
    $('connect-submit').disabled = false;
    $('connect-retrying').hidden = !retrying;
  }

  function hideConnect() {
    document.body.classList.remove('is-connect');
    $('connect').hidden = true;
    clearTimeout(retryTimer);
  }

  function setStatus(status) {
    app.status = status;
    if (status === 'reconnecting') app.awaitingSnapshot = true;
    if (app.derived) renderHeader();
  }

  async function attach(backend) {
    app.backend = backend;
    app.awaitingSnapshot = true;
    backend.on('status', setStatus);
    backend.on('disconnected', () => {
      app.awaitingSnapshot = true;
    });
    backend.on('ready', () => {
      loadMeta();
      refreshHistory();
    });
    backend.on('auth-error', () => {
      HB.clearAuth();
      showConnect({ error: 'Home Assistant ended the session. Sign in again.' });
    });
    setStatus(backend.kind === 'demo' ? 'demo' : 'connected');
    hideConnect();
    document.body.classList.add('is-booting');
    setTimeout(() => document.body.classList.remove('is-booting'), BOOT_ANIMATION_MS);
    await loadMeta();
    await backend.subscribe({ type: 'subscribe_entities' }, onEntities);
    app.timers.forEach(clearInterval);
    app.timers = [
      setInterval(renderEverything, RELATIVE_TICK_MS),
      setInterval(refreshHistory, HISTORY_REFRESH_MS),
      setInterval(loadMeta, META_REFRESH_MS),
      setInterval(loadForecast, META_REFRESH_MS),
      setInterval(() => app.sections.has('cameras') && renderEverything(), CAMERA_TICK_MS),
    ];
  }

  /** Starts a backend; returns true on success. Network failures with saved credentials retry. */
  async function start(backend, { retry = false } = {}) {
    try {
      await backend.start();
    } catch (err) {
      if (err instanceof HB.AuthError) {
        HB.clearAuth();
        showConnect({ error: err.message, url: backend.hassUrl });
        return false;
      }
      if (retry) {
        showConnect({ error: `${err.message} Retrying in ${Math.round(retryDelay / SECOND)} s.`, url: backend.hassUrl, retrying: true });
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => start(backend, { retry: true }), retryDelay);
        retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
        return false;
      }
      showConnect({ error: err.message, url: backend.hassUrl });
      return false;
    }
    try {
      await attach(backend);
      return true;
    } catch (err) {
      showConnect({ error: `Connected, but loading your entities failed: ${err.message}`, url: backend.hassUrl });
      return false;
    }
  }

  async function submitConnect(event) {
    event.preventDefault();
    clearTimeout(retryTimer);
    const url = HB.normalizeUrl($('connect-url').value);
    if (!url) {
      showConnect({ error: 'Enter your Home Assistant address, for example http://homeassistant.local:8123.' });
      return;
    }
    const token = $('connect-token').value.trim();
    if (!token) {
      HB.startLogin(url);
      return;
    }
    $('connect-submit').disabled = true;
    $('connect-error').hidden = true;
    const ok = await start(HB.tokenBackend(url, token));
    if (ok) $('connect-token').value = '';
  }

  async function boot() {
    document.querySelectorAll('[data-icon]').forEach((el) => el.insertAdjacentHTML('afterbegin', HB.icon(el.dataset.icon)));
    applySettings();
    HB.detail.init();
    bindEvents();
    tickClock();
    setInterval(tickClock, SECOND);
    app.config = await loadConfigFile();
    app.filters = HB.compileFilters(app.config);
    applySettings();
    $('hud-wake').setAttribute('aria-pressed', 'false');
    if (app.settings.keepAwake && 'wakeLock' in navigator) {
      requestWakeLock(false).then(() => $('hud-wake').setAttribute('aria-pressed', String(Boolean(app.wakeLock))));
    }
    let backend = null;
    try {
      backend = await HB.resolveBackend();
    } catch (err) {
      showConnect({ error: err.message });
      return;
    }
    if (!backend) {
      showConnect();
      return;
    }
    await start(backend, { retry: backend.kind === 'ha' && !backend.embedded });
  }

  HB.VERSION = '1.0.0';
  document.addEventListener('DOMContentLoaded', boot);
})(window.HB = window.HB || {});
