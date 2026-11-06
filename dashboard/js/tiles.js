/*
 * Habitat — tile renderers. Each returns { html, cls, label, glow, primary }:
 *   html     inner markup of the tile (all entity text is escaped)
 *   cls      state modifiers for the tile element
 *   label    accessible name for the tile's primary button
 *   glow     "r,g,b" tint for lit lights
 *   primary  what tapping the tile does: 'detail', 'toggle', 'scene' or null
 */
(function (HB) {
  'use strict';

  const esc = HB.esc;
  const tiles = (HB.tiles = {});

  const BINARY_LABELS = {
    door: ['Closed', 'Open'], garage_door: ['Closed', 'Open'], window: ['Closed', 'Open'], opening: ['Closed', 'Open'],
    motion: ['Clear', 'Motion'], occupancy: ['Clear', 'Occupied'], presence: ['Away', 'Home'], moving: ['Still', 'Moving'],
    smoke: ['Clear', 'Smoke'], gas: ['Clear', 'Gas'], carbon_monoxide: ['Clear', 'CO detected'], moisture: ['Dry', 'Leak'],
    problem: ['OK', 'Problem'], safety: ['Safe', 'Unsafe'], tamper: ['Clear', 'Tampered'], heat: ['Normal', 'Hot'],
    cold: ['Normal', 'Cold'], connectivity: ['Offline', 'Online'], plug: ['Unplugged', 'Plugged in'], power: ['Off', 'Powered'],
    battery: ['Normal', 'Low'], battery_charging: ['Not charging', 'Charging'], lock: ['Locked', 'Unlocked'],
    light: ['Dark', 'Light'], sound: ['Quiet', 'Sound'], vibration: ['Still', 'Vibration'], running: ['Idle', 'Running'],
    update: ['Up to date', 'Update'],
  };

  const CONDITION_LABELS = {
    'clear-night': 'Clear night', cloudy: 'Cloudy', exceptional: 'Exceptional', fog: 'Fog', hail: 'Hail',
    lightning: 'Thunderstorm', 'lightning-rainy': 'Thunder showers', partlycloudy: 'Partly cloudy', pouring: 'Pouring rain',
    rainy: 'Rain', snowy: 'Snow', 'snowy-rainy': 'Sleet', sunny: 'Sunny', windy: 'Windy', 'windy-variant': 'Windy',
  };

  const STATE_LABELS = {
    on: 'On', off: 'Off', open: 'Open', closed: 'Closed', opening: 'Opening', closing: 'Closing', locked: 'Locked',
    unlocked: 'Unlocked', locking: 'Locking', unlocking: 'Unlocking', jammed: 'Jammed', playing: 'Playing',
    paused: 'Paused', idle: 'Idle', standby: 'Standby', buffering: 'Buffering', home: 'Home', not_home: 'Away',
    unavailable: 'Unavailable', unknown: 'Unknown', disarmed: 'Disarmed', armed_home: 'Armed home',
    armed_away: 'Armed away', armed_night: 'Armed night', armed_vacation: 'Armed vacation',
    armed_custom_bypass: 'Armed custom', arming: 'Arming', pending: 'Pending', triggered: 'Triggered',
    docked: 'Docked', cleaning: 'Cleaning', returning: 'Returning', heat: 'Heat', cool: 'Cool', auto: 'Auto',
    heat_cool: 'Heat/cool', dry: 'Dry', fan_only: 'Fan only', heating: 'Heating', cooling: 'Cooling',
  };

  /** Human label for a state value. */
  HB.stateLabel = (st) => {
    if (HB.domainOf(st.entity_id) === 'binary_sensor' && !HB.isOffline(st)) {
      const pair = BINARY_LABELS[st.attributes.device_class] || ['Off', 'On'];
      return st.state === 'on' ? pair[1] : pair[0];
    }
    return STATE_LABELS[st.state] || (/^[a-z0-9_]+$/.test(st.state) ? HB.humanize(st.state) : st.state);
  };

  HB.conditionLabel = (condition) => CONDITION_LABELS[condition] || HB.humanize(condition);

  const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const compass = (bearing) => (Number.isFinite(bearing) ? COMPASS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8] : '');

  const MEDIA_FEATURES = { PAUSE: 1, PREVIOUS: 16, NEXT: 32, PLAY: 16384 };
  const COVER_FEATURES = { OPEN: 1, CLOSE: 2, STOP: 8 };
  const PRESENCE_LIMIT = 4;
  const CONSUMER_LIMIT = 4;
  const FORECAST_LIMIT = 5;
  const BATTERY_SUFFIX = /\s+battery( level)?$/i;
  const POWER_SUFFIX = /\s+power$/i;

  function badge(text, tone = '') {
    return `<span class="t-badge${tone ? ` t-badge--${tone}` : ''}">${esc(text)}</span>`;
  }

  function head(iconName, areaText, extra = '') {
    return `<div class="t-head"><span class="t-icon">${HB.icon(iconName)}</span><span class="t-area">${esc(areaText)}</span>${extra}</div>`;
  }

  function moreButton(id, name) {
    return `<button class="t-btn t-more" type="button" data-action="detail" data-id="${esc(id)}" aria-label="Details for ${esc(name)}">${HB.icon('chevron')}</button>`;
  }

  function basics(item, ctx) {
    const st = ctx.states.get(item.id);
    return { st, a: st.attributes, name: HB.displayName(ctx, st), area: HB.areaNameOf(ctx, item.id), offline: HB.isOffline(st) };
  }

  function sinceText(st, now) {
    return Number.isFinite(st.last_changed) ? `for ${HB.fmtDuration(now - st.last_changed)}` : '';
  }

  function numberValue(ctx, id, st) {
    return HB.formatNumber(st.state, HB.precisionOf(ctx, id));
  }

  function statTile(item, ctx) {
    const { st, a, name, area, offline } = basics(item, ctx);
    const unit = a.unit_of_measurement || '';
    const value = offline ? '—' : numberValue(ctx, item.id, st);
    const series = ctx.history.get(item.id);
    const spark = series && !offline ? HB.charts.sparkline(series, ctx.window) : '';
    return {
      cls: `t-stat${offline ? ' is-offline' : ''}`,
      label: `${name}${area ? `, ${area}` : ''}: ${offline ? 'unavailable' : `${value} ${unit}`}`,
      html:
        head(HB.entityIconName(st), area, offline ? badge('Offline', 'muted') : '') +
        `<div class="t-name">${esc(name)}</div>` +
        `<div class="t-value">${esc(value)}<span class="t-unit">${esc(unit)}</span></div>` +
        (spark || '<div class="spark spark--empty"></div>'),
      primary: 'detail',
    };
  }

  function textTile(item, ctx) {
    const { st, a, name, area, offline } = basics(item, ctx);
    let value = HB.stateLabel(st);
    let sub = sinceText(st, ctx.now);
    if (a.device_class === 'timestamp' && !offline) {
      const t = Date.parse(st.state);
      if (Number.isFinite(t)) {
        value = HB.fmtAgo(t, ctx.now);
        sub = HB.fmtDayTime(t);
      }
    }
    return {
      cls: `t-text${offline ? ' is-offline' : ''}`,
      label: `${name}: ${value}`,
      html: head(HB.entityIconName(st), area) + `<div class="t-name">${esc(name)}</div><div class="t-state t-state--text">${esc(value)}</div><div class="t-since">${esc(sub)}</div>`,
      primary: 'detail',
    };
  }

  function gaugeSeverity(st, value) {
    const dc = st.attributes.device_class;
    if (dc === 'humidity' || dc === 'moisture') {
      if (value < 30) return { severity: 'warning', note: 'Dry' };
      if (value > 70) return { severity: 'warning', note: 'Humid' };
      return { severity: 'accent', note: '' };
    }
    const severity = HB.charts.severity(value, 80, 95);
    return { severity, note: severity === 'critical' ? 'Critical' : severity === 'warning' ? 'High' : '' };
  }

  function gaugeTile(item, ctx) {
    const { st, a, name, area, offline } = basics(item, ctx);
    const value = Number(st.state);
    const unit = a.unit_of_measurement || '';
    const { severity, note } = offline ? { severity: 'accent', note: '' } : gaugeSeverity(st, value);
    const display = offline ? '—' : numberValue(ctx, item.id, st);
    return {
      cls: `t-gauge-tile${offline ? ' is-offline' : ''}`,
      label: `${name}: ${display}${unit}${note ? `, ${note}` : ''}`,
      html:
        head(HB.entityIconName(st), area, note ? badge(note, severity) : '') +
        `<div class="t-gauge">${HB.charts.arcGauge(value / 100, { severity })}` +
        `<div class="t-gauge__value">${esc(display)}<span>${esc(unit)}</span></div></div>` +
        `<div class="t-name t-name--center">${esc(name)}</div>`,
      primary: 'detail',
    };
  }

  function binaryTile(item, ctx) {
    const { st, name, area, offline } = basics(item, ctx);
    const on = st.state === 'on';
    const alert = HB.isAlert(st);
    const label = HB.stateLabel(st);
    return {
      cls: `t-binary${on ? ' is-on' : ''}${alert ? ' is-alert' : ''}${offline ? ' is-offline' : ''}`,
      label: `${name}: ${label}`,
      html:
        head(HB.entityIconName(st), area, alert ? badge('Alert', 'critical') : '') +
        `<div class="t-name">${esc(name)}</div>` +
        `<div class="t-state">${alert ? HB.icon('alert', 'ic--inline') : ''}${esc(label)}</div>` +
        `<div class="t-since">${esc(offline ? '' : sinceText(st, ctx.now))}</div>`,
      primary: 'detail',
    };
  }

  function brightnessPct(a) {
    return Number.isFinite(a.brightness) && a.brightness > 0 ? Math.max(1, Math.round((a.brightness / 255) * 100)) : null;
  }

  const WARM_GLOW = '255,206,150';

  function toggleTile(item, ctx) {
    const { st, a, name, area, offline } = basics(item, ctx);
    const domain = HB.domainOf(item.id);
    const on = st.state === 'on';
    const pct = domain === 'light' ? brightnessPct(a) : domain === 'fan' && Number.isFinite(a.percentage) ? a.percentage : null;
    const glow = domain === 'light' && on ? HB.rgbList(a.rgb_color) || WARM_GLOW : null;
    const stateText = offline ? 'Offline' : on ? (pct ? `On · ${pct}%` : 'On') : 'Off';
    return {
      cls: `t-toggle${on ? ' is-on' : ''}${offline ? ' is-offline' : ''}`,
      glow,
      label: `${name}${area ? `, ${area}` : ''}: ${stateText}. ${offline ? 'Open details' : on ? 'Turn off' : 'Turn on'}`,
      html:
        `<div class="t-head"><span class="t-orb">${HB.icon(HB.entityIconName(st))}</span><span class="t-area">${esc(area)}</span>${moreButton(item.id, name)}</div>` +
        `<div class="t-name t-name--2">${esc(name)}</div>` +
        `<div class="t-foot"><span class="t-state t-state--sm">${esc(stateText)}</span>${on && pct ? HB.charts.meter(pct / 100, { severity: 'glow' }) : ''}</div>`,
      primary: offline ? 'detail' : 'toggle',
    };
  }

  function climateTargets(a) {
    if (Number.isFinite(a.temperature)) return { single: a.temperature, text: HB.formatNumber(a.temperature, 1) };
    if (Number.isFinite(a.target_temp_low) && Number.isFinite(a.target_temp_high)) {
      return { single: null, text: `${HB.formatNumber(a.target_temp_low, 1)}–${HB.formatNumber(a.target_temp_high, 1)}` };
    }
    return { single: null, text: '' };
  }

  function climateTile(item, ctx) {
    const { st, a, name, area, offline } = basics(item, ctx);
    const unit = ctx.units.temperature || '°C';
    const min = Number.isFinite(a.min_temp) ? a.min_temp : 7;
    const max = Number.isFinite(a.max_temp) ? a.max_temp : 35;
    const current = a.current_temperature;
    const target = climateTargets(a);
    const span = max - min || 1;
    const fraction = Number.isFinite(current) ? (current - min) / span : 0;
    const marker = target.single != null ? (target.single - min) / span : null;
    const action = a.hvac_action ? HB.stateLabel({ entity_id: item.id, state: a.hvac_action, attributes: {} }) : '';
    const canStep = !offline && target.single != null && st.state !== 'off';
    const step = a.target_temp_step || (unit === '°F' ? 1 : 0.5);
    const active = a.hvac_action === 'heating' || a.hvac_action === 'cooling';
    return {
      cls: `t-climate${active ? ' is-on' : ''}${offline ? ' is-offline' : ''}`,
      label: `${name}: ${Number.isFinite(current) ? `${HB.formatNumber(current, 1)}${unit}` : 'no reading'}, target ${target.text || 'none'}${unit}, ${HB.stateLabel(st)}`,
      html:
        head(HB.entityIconName(st), area, action ? badge(action, active ? 'active' : '') : '') +
        `<div class="t-name">${esc(name)}</div>` +
        `<div class="t-ring">${HB.charts.arcGauge(fraction, { marker })}` +
        `<div class="t-ring__center"><span class="t-ring__value">${esc(Number.isFinite(current) ? HB.formatNumber(current, 1) : '—')}<span class="t-unit">${esc(unit)}</span></span>` +
        `<span class="t-ring__sub">${target.text ? `Target ${esc(target.text)}${esc(unit)}` : esc(HB.stateLabel(st))}</span></div></div>` +
        `<div class="t-stepper">` +
        `<button class="t-btn" type="button" data-action="temp-step" data-arg="${-step}" aria-label="Lower target temperature" ${canStep ? '' : 'disabled'}>${HB.icon('minus')}</button>` +
        `<span class="t-stepper__mode">${esc(HB.stateLabel(st))}</span>` +
        `<button class="t-btn" type="button" data-action="temp-step" data-arg="${step}" aria-label="Raise target temperature" ${canStep ? '' : 'disabled'}>${HB.icon('plus')}</button>` +
        `</div>`,
      primary: 'detail',
    };
  }

  function coverTile(item, ctx) {
    const { st, a, name, area, offline } = basics(item, ctx);
    const position = Number.isFinite(a.current_position) ? a.current_position : null;
    const features = a.supported_features || 0;
    const button = (action, icon, label, feature) =>
      features & feature ? `<button class="t-btn" type="button" data-action="${action}" aria-label="${label} ${esc(name)}" ${offline ? 'disabled' : ''}>${HB.icon(icon)}</button>` : '';
    const isOpen = st.state === 'open' || st.state === 'opening';
    return {
      cls: `t-cover${isOpen ? ' is-on' : ''}${offline ? ' is-offline' : ''}`,
      label: `${name}: ${HB.stateLabel(st)}${position != null ? `, ${position}% open` : ''}`,
      html:
        head(HB.entityIconName(st), area) +
        `<div class="t-name">${esc(name)}</div>` +
        `<div class="t-foot"><span class="t-state t-state--sm">${esc(HB.stateLabel(st))}${position != null ? ` · ${position}%` : ''}</span>${position != null ? HB.charts.meter(position / 100) : ''}</div>` +
        `<div class="t-actions">${button('cover-open', 'chevronUp', 'Open', COVER_FEATURES.OPEN)}${button('cover-stop', 'stop', 'Stop', COVER_FEATURES.STOP)}${button('cover-close', 'chevronDown', 'Close', COVER_FEATURES.CLOSE)}</div>`,
      primary: 'detail',
    };
  }

  function lockTile(item, ctx) {
    const { st, name, area, offline } = basics(item, ctx);
    const unlocked = st.state === 'unlocked' || st.state === 'open';
    const jammed = st.state === 'jammed';
    return {
      cls: `t-lock${unlocked ? ' is-on' : ''}${jammed ? ' is-alert' : ''}${offline ? ' is-offline' : ''}`,
      label: `${name}: ${HB.stateLabel(st)}. Open controls`,
      html:
        head(HB.entityIconName(st), area, jammed ? badge('Jammed', 'critical') : '') +
        `<div class="t-name">${esc(name)}</div><div class="t-state">${esc(HB.stateLabel(st))}</div><div class="t-since">${esc(sinceText(st, ctx.now))}</div>`,
      primary: 'detail',
    };
  }

  function alarmTile(item, ctx) {
    const { st, name, area, offline } = basics(item, ctx);
    const tone = st.state === 'triggered' ? 'critical' : st.state.startsWith('armed') ? 'good' : st.state === 'disarmed' ? 'muted' : 'warning';
    return {
      cls: `t-alarm${st.state === 'triggered' ? ' is-alert' : ''}${offline ? ' is-offline' : ''}`,
      label: `${name}: ${HB.stateLabel(st)}`,
      html:
        head('shield', area) +
        `<div class="t-name">${esc(name)}</div>` +
        `<div class="t-state">${badge(HB.stateLabel(st), tone)}</div><div class="t-since">${esc(sinceText(st, ctx.now))}</div>`,
      primary: 'detail',
    };
  }

  function statusTile(item, ctx) {
    const { st, a, name, area, offline } = basics(item, ctx);
    const battery = Number.isFinite(a.battery_level) ? `Battery ${a.battery_level}%` : sinceText(st, ctx.now);
    const active = ['cleaning', 'on', 'open', 'mowing', 'heat', 'heating'].includes(st.state);
    return {
      cls: `t-status${active ? ' is-on' : ''}${offline ? ' is-offline' : ''}`,
      label: `${name}: ${HB.stateLabel(st)}`,
      html: head(HB.entityIconName(st), area) + `<div class="t-name">${esc(name)}</div><div class="t-state">${esc(HB.stateLabel(st))}</div><div class="t-since">${esc(battery)}</div>`,
      primary: 'detail',
    };
  }

  /** Track length as m:ss, or h:mm:ss from an hour up. */
  function clockDuration(totalSeconds) {
    const total = Math.round(totalSeconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = String(total % 60).padStart(2, '0');
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
  }

  function mediaProgress(a, now) {
    const duration = Number(a.media_duration);
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(Number(a.media_position))) return '';
    const updated = Date.parse(a.media_position_updated_at);
    const elapsed = Number.isFinite(updated) ? Math.max(0, (now - updated) / 1000) : 0;
    const position = HB.clamp(Number(a.media_position) + elapsed, 0, duration);
    const p0 = position / duration;
    const remaining = Math.round(duration - position);
    return `<div class="t-progress" style="--p0:${p0.toFixed(4)};--remaining:${remaining}s"><i></i></div><span class="t-duration">${clockDuration(duration)}</span>`;
  }

  function mediaTile(item, ctx) {
    const { st, a, name, area, offline } = basics(item, ctx);
    const playing = st.state === 'playing';
    const active = playing || st.state === 'paused' || st.state === 'buffering';
    const art = active ? HB.safeImageUrl(a.entity_picture, ctx.hassUrl) : null;
    const features = a.supported_features || 0;
    const title = active && a.media_title ? a.media_title : HB.stateLabel(st);
    const artist = active ? a.media_artist || a.media_series_title || a.app_name || '' : name;
    const button = (action, icon, label, feature) =>
      features & feature ? `<button class="t-btn" type="button" data-action="${action}" aria-label="${label}">${HB.icon(icon)}</button>` : '';
    const controls = active && !offline
      ? `<div class="t-media__controls">${button('media-prev', 'prev', 'Previous track', MEDIA_FEATURES.PREVIOUS)}` +
        `${button('media-toggle', playing ? 'pause' : 'play', playing ? 'Pause' : 'Play', playing ? MEDIA_FEATURES.PAUSE : MEDIA_FEATURES.PLAY)}` +
        `${button('media-next', 'next', 'Next track', MEDIA_FEATURES.NEXT)}</div>`
      : '';
    return {
      cls: `t-media${playing ? ' is-on' : ''}${offline ? ' is-offline' : ''}`,
      label: `${name}: ${active ? `${HB.stateLabel(st)} ${title}${artist ? ` by ${artist}` : ''}` : HB.stateLabel(st)}`,
      html:
        `<div class="t-media__art">${art ? `<img src="${esc(art)}" alt="" loading="lazy">` : HB.icon(HB.entityIconName(st))}</div>` +
        `<div class="t-media__body">` +
        `<div class="t-area">${esc(active ? `${name}${a.app_name ? ` · ${a.app_name}` : ''}` : area || 'Media')}</div>` +
        `<div class="t-media__title">${esc(title)}</div><div class="t-media__artist">${esc(artist)}</div>` +
        `${controls}${playing || st.state === 'paused' ? `<div class="t-media__time${playing ? '' : ' is-paused'}">${mediaProgress(a, ctx.now)}</div>` : ''}` +
        `</div>`,
      primary: 'detail',
    };
  }

  const CAMERA_REFRESH_MS = 10 * 1000;

  function cameraTile(item, ctx) {
    const { st, a, name, area, offline } = basics(item, ctx);
    const base = HB.safeImageUrl(a.entity_picture, ctx.hassUrl);
    const src = base ? `${base}${base.includes('?') ? '&' : '?'}_=${Math.floor(ctx.now / CAMERA_REFRESH_MS)}` : null;
    return {
      cls: `t-camera${offline ? ' is-offline' : ''}`,
      label: `${name} camera: ${HB.stateLabel(st)}`,
      html:
        (src && !offline ? `<img class="t-camera__img" src="${esc(src)}" alt="">` : `<div class="t-camera__empty">${HB.icon('camera')}</div>`) +
        `<div class="t-camera__bar"><span class="t-name">${esc(name)}</span><span class="t-area">${esc(area)} · ${esc(HB.stateLabel(st))}</span></div>`,
      primary: 'detail',
    };
  }

  function sceneTile(item, ctx) {
    const { st, name } = basics(item, ctx);
    const last = Date.parse(st.state);
    return {
      cls: 't-scene',
      label: `Activate scene ${name}`,
      html: `<span class="t-icon">${HB.icon('sparkle')}</span><span class="t-scene__name">${esc(name)}</span><span class="t-scene__when">${esc(Number.isFinite(last) ? HB.fmtAgo(last, ctx.now) : '')}</span>`,
      primary: 'scene',
    };
  }

  function batteryTile(item, ctx) {
    const { st, name: fullName, area, offline } = basics(item, ctx);
    const name = fullName.replace(BATTERY_SUFFIX, '') || fullName;
    const value = Number(st.state);
    const severity = offline ? 'accent' : HB.charts.severity(value, HB.BATTERY.LOW, HB.BATTERY.CRITICAL, true);
    const low = severity !== 'accent';
    return {
      cls: `t-battery${low ? ` is-${severity}` : ''}${offline ? ' is-offline' : ''}`,
      label: `${name}: ${offline ? 'unavailable' : `${value}%`}${low ? ', low battery' : ''}`,
      html:
        `<span class="t-battery__name">${low ? HB.icon('alert', 'ic--inline') : ''}${esc(name)}<small>${esc(area)}</small></span>` +
        `${HB.charts.meter(value / 100, { severity, segmented: true })}<span class="t-battery__value">${esc(offline ? '—' : `${Math.round(value)}%`)}</span>`,
      primary: 'detail',
    };
  }

  // ---- Overview tiles ------------------------------------------------------------------------

  function weatherTile(item, ctx) {
    const id = ctx.derived.weatherId;
    const st = ctx.states.get(id);
    const a = st.attributes;
    const unit = a.temperature_unit || ctx.units.temperature || '°C';
    const forecast = (ctx.forecast.get(id) || a.forecast || []).slice(0, FORECAST_LIMIT);
    const lows = forecast.map((f) => (Number.isFinite(f.templow) ? f.templow : f.temperature));
    const lo = Math.min(...lows);
    const hi = Math.max(...forecast.map((f) => f.temperature));
    const span = hi - lo || 1;
    const today = new Date(ctx.now).toDateString();
    const rows = forecast
      .map((f, i) => {
        const t = Date.parse(f.datetime);
        const low = lows[i];
        const left = ((low - lo) / span) * 100;
        const width = Math.max(4, ((f.temperature - low) / span) * 100);
        const day = new Date(t).toDateString() === today ? 'Today' : HB.fmtWeekday(t);
        return (
          `<li class="fc"><span class="fc__day">${esc(day)}</span><span class="fc__icon" title="${esc(HB.conditionLabel(f.condition))}">${HB.icon(HB.weatherIcon(f.condition))}</span>` +
          `<span class="fc__lo">${esc(HB.formatNumber(low, 0))}°</span><span class="fc__bar"><i style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%"></i></span>` +
          `<span class="fc__hi">${esc(HB.formatNumber(f.temperature, 0))}°</span></li>`
        );
      })
      .join('');
    const sun = ctx.derived.sunId ? ctx.states.get(ctx.derived.sunId).attributes : null;
    const meta = [];
    if (Number.isFinite(a.humidity)) meta.push(`${HB.icon('droplet')}${esc(HB.formatNumber(a.humidity, 0))}%`);
    if (Number.isFinite(a.wind_speed)) meta.push(`${HB.icon('wind')}${esc(HB.formatNumber(a.wind_speed, 0))} ${esc(a.wind_speed_unit || '')} ${esc(compass(a.wind_bearing))}`);
    if (Number.isFinite(a.pressure)) meta.push(`${HB.icon('gauge')}${esc(HB.formatNumber(a.pressure, 0))} ${esc(a.pressure_unit || '')}`);
    const sunLine = sun && sun.next_rising && sun.next_setting
      ? `<div class="t-sun"><span>${HB.icon('sunrise')}${esc(HB.fmtTime(Date.parse(sun.next_rising)))}</span><span>${HB.icon('sunset')}${esc(HB.fmtTime(Date.parse(sun.next_setting)))}</span></div>`
      : '';
    const temp = Number.isFinite(a.temperature) ? HB.formatNumber(a.temperature, 1) : '—';
    return {
      cls: 't-weather',
      label: `Weather: ${HB.conditionLabel(st.state)}, ${temp}${unit}`,
      html:
        head('cloudSun', 'Weather', badge(a.friendly_name || 'Home')) +
        `<div class="t-weather__now"><span class="t-weather__icon">${HB.icon(HB.weatherIcon(st.state))}</span>` +
        `<div><div class="t-hero">${esc(temp)}<span class="t-unit">${esc(unit)}</span></div>` +
        `<div class="t-weather__cond">${esc(HB.conditionLabel(st.state))}${Number.isFinite(a.apparent_temperature) ? ` · feels ${esc(HB.formatNumber(a.apparent_temperature, 0))}°` : ''}</div></div></div>` +
        `<div class="t-meta">${meta.map((m) => `<span>${m}</span>`).join('')}</div>` +
        (rows ? `<ul class="fc-list">${rows}</ul>` : '<p class="t-note">Forecast unavailable</p>') +
        sunLine,
      primary: 'detail',
      target: id,
    };
  }

  function powerTile(item, ctx) {
    const id = ctx.derived.mainPowerId;
    const st = ctx.states.get(id);
    const unit = st.attributes.unit_of_measurement || 'W';
    const watts = HB.toWatts(st.state, unit);
    const now = HB.formatWatts(watts);
    const series = ctx.history.get(id) || [];
    const recent = series.filter(([t]) => t >= ctx.window.start).map(([, v]) => HB.toWatts(v, unit));
    const peak = recent.length ? HB.formatWatts(Math.max(...recent)) : null;
    const low = recent.length ? HB.formatWatts(Math.min(...recent)) : null;
    const consumers = ctx.derived.consumerIds.slice(0, CONSUMER_LIMIT).map((cid) => {
      const cst = ctx.states.get(cid);
      const cw = HB.toWatts(cst.state, cst.attributes.unit_of_measurement || 'W');
      const share = watts > 0 ? HB.clamp(cw / watts, 0, 1) : 0;
      const shown = HB.formatWatts(cw);
      return (
        `<li class="rank"><button class="rank__btn" type="button" data-action="detail" data-id="${esc(cid)}">` +
        `<span class="rank__name">${esc(HB.displayName(ctx, cst).replace(POWER_SUFFIX, ''))}</span>` +
        `<span class="rank__bar"><i style="width:${(share * 100).toFixed(1)}%"></i></span>` +
        `<span class="rank__value">${esc(shown.value)} ${esc(shown.unit)}</span></button></li>`
      );
    });
    return {
      cls: 't-power',
      label: `Power draw: ${now.value} ${now.unit}`,
      html:
        head('bolt', 'Power draw', badge('Live', 'active')) +
        `<div class="t-hero">${esc(now.value)}<span class="t-unit">${esc(now.unit)}</span></div>` +
        `<div class="t-sub">${peak ? `24h peak ${esc(peak.value)} ${esc(peak.unit)} · low ${esc(low.value)} ${esc(low.unit)}` : esc(HB.displayName(ctx, st))}</div>` +
        `<div class="t-power__chart">${HB.charts.sparkline(series, ctx.window)}</div>` +
        (consumers.length ? `<div class="t-label">Top consumers now</div><ul class="rank-list">${consumers.join('')}</ul>` : ''),
      primary: 'detail',
      target: id,
    };
  }

  function indoorTile(item, ctx) {
    const temps = ctx.derived.indoorTempIds.map((id) => ctx.states.get(id)).filter((st) => HB.isNumeric(st.state));
    if (!temps.length) return { cls: 't-indoor', label: 'Indoor climate', html: head('thermometer', 'Indoor climate'), primary: null };
    const unit = temps[0].attributes.unit_of_measurement || '°C';
    const avg = temps.reduce((sum, st) => sum + Number(st.state), 0) / temps.length;
    const sorted = [...temps].sort((x, y) => Number(y.state) - Number(x.state));
    const humid = ctx.derived.indoorHumidityIds.map((id) => ctx.states.get(id)).filter((st) => HB.isNumeric(st.state));
    const humidity = humid.length ? humid.reduce((sum, st) => sum + Number(st.state), 0) / humid.length : null;
    const row = (label, st) =>
      `<li><button class="kv" type="button" data-action="detail" data-id="${esc(st.entity_id)}"><span>${esc(label)}</span>` +
      `<strong>${esc(HB.formatNumber(st.state, 1))}${esc(unit)}</strong><small>${esc(HB.areaNameOf(ctx, st.entity_id) || HB.displayName(ctx, st))}</small></button></li>`;
    return {
      cls: 't-indoor',
      label: `Indoor average ${HB.formatNumber(avg, 1)}${unit}`,
      html:
        head('thermometer', 'Indoor climate', badge(`${temps.length} rooms`)) +
        `<div class="t-indoor__body"><div><div class="t-hero t-hero--md">${esc(HB.formatNumber(avg, 1))}<span class="t-unit">${esc(unit)}</span></div>` +
        `<div class="t-sub">Average${humidity != null ? ` · ${esc(HB.formatNumber(humidity, 0))}% humidity` : ''}</div></div>` +
        `<ul class="kv-list">${row('Warmest', sorted[0])}${sorted.length > 1 ? row('Coolest', sorted[sorted.length - 1]) : ''}</ul></div>`,
      primary: null,
    };
  }

  function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');
  }

  function presenceTile(item, ctx) {
    const people = ctx.derived.personIds.map((id) => ctx.states.get(id));
    const home = people.filter((st) => st.state === 'home').length;
    const shown = people.slice(0, PRESENCE_LIMIT).map((st) => {
      const name = st.attributes.friendly_name || HB.humanize(HB.objectId(st.entity_id));
      const picture = HB.safeImageUrl(st.attributes.entity_picture, ctx.hassUrl);
      const isHome = st.state === 'home';
      return (
        `<li><button class="person${isHome ? ' is-home' : ''}" type="button" data-action="detail" data-id="${esc(st.entity_id)}" aria-label="${esc(name)}: ${esc(HB.stateLabel(st))}">` +
        `<span class="person__avatar">${picture ? `<img src="${esc(picture)}" alt="">` : esc(initials(name))}</span>` +
        `<span class="person__name">${esc(name)}</span><span class="person__state">${esc(HB.stateLabel(st))}</span></button></li>`
      );
    });
    const extra = people.length > PRESENCE_LIMIT ? `<li class="person person--more">+${people.length - PRESENCE_LIMIT}</li>` : '';
    return {
      cls: 't-presence',
      label: `${home} of ${people.length} people home`,
      html: head('home', 'Presence', badge(`${home} of ${people.length} home`, home ? 'active' : '')) + `<ul class="people">${shown.join('')}${extra}</ul>`,
      primary: null,
    };
  }

  const RENDERERS = {
    stat: statTile, text: textTile, gauge: gaugeTile, binary: binaryTile, light: toggleTile, toggle: toggleTile,
    climate: climateTile, cover: coverTile, lock: lockTile, alarm: alarmTile, status: statusTile, media: mediaTile,
    camera: cameraTile, scene: sceneTile, battery: batteryTile, weather: weatherTile, power: powerTile,
    indoor: indoorTile, presence: presenceTile,
  };

  /** Renders one tile; composite overview tiles read from ctx.derived. */
  tiles.render = (item, ctx) => (RENDERERS[item.kind] || textTile)(item, ctx);
})(window.HB = window.HB || {});
