/* Habitat — turns raw Home Assistant states into sections of tiles, plus home-wide summaries. */
(function (HB) {
  'use strict';

  HB.SECTIONS = [
    { id: 'pulse', title: 'Overview' },
    { id: 'scenes', title: 'Scenes' },
    { id: 'lighting', title: 'Lighting' },
    { id: 'climate', title: 'Climate' },
    { id: 'security', title: 'Security' },
    { id: 'controls', title: 'Controls' },
    { id: 'media', title: 'Media' },
    { id: 'cameras', title: 'Cameras' },
    { id: 'energy', title: 'Energy' },
    { id: 'atmosphere', title: 'Air & environment' },
    { id: 'sensors', title: 'Sensors' },
    { id: 'system', title: 'System' },
    { id: 'batteries', title: 'Batteries' },
  ];

  const OFFLINE_STATES = new Set(['unavailable', 'unknown']);
  HB.isOffline = (st) => !st || OFFLINE_STATES.has(st.state);

  const LOW_BATTERY = 20;
  const CRITICAL_BATTERY = 10;
  HB.BATTERY = { LOW: LOW_BATTERY, CRITICAL: CRITICAL_BATTERY };

  const ALERT_CLASSES = new Set(['smoke', 'gas', 'carbon_monoxide', 'moisture', 'problem', 'safety', 'tamper', 'heat', 'cold']);
  const SECURITY_CLASSES = new Set([
    'door', 'garage_door', 'window', 'opening', 'motion', 'occupancy', 'presence', 'moving', 'vibration',
    'lock', 'sound', ...ALERT_CLASSES,
  ]);
  const ENERGY_CLASSES = new Set([
    'power', 'energy', 'voltage', 'current', 'power_factor', 'apparent_power', 'reactive_power', 'frequency',
    'gas', 'water', 'monetary', 'energy_storage',
  ]);
  const ATMOSPHERE_CLASSES = new Set([
    'carbon_dioxide', 'carbon_monoxide', 'pm1', 'pm25', 'pm10', 'volatile_organic_compounds',
    'volatile_organic_compounds_parts', 'nitrogen_dioxide', 'nitrogen_monoxide', 'nitrous_oxide', 'ozone',
    'sulphur_dioxide', 'aqi', 'pressure', 'atmospheric_pressure', 'illuminance', 'irradiance', 'sound_pressure',
    'precipitation', 'precipitation_intensity', 'wind_speed', 'wind_direction',
  ]);
  const CONTROL_DOMAINS = new Set(['switch', 'input_boolean', 'fan', 'cover', 'vacuum', 'lawn_mower', 'water_heater', 'humidifier', 'valve']);
  const TOGGLE_DOMAINS = new Set(['switch', 'input_boolean', 'fan', 'light']);
  HB.TOGGLE_DOMAINS = TOGGLE_DOMAINS;

  const SYSTEM_ID_RE = /(processor_use|processor_temperature|cpu_|_cpu|memory_use|memory_usage|memory_free|disk_use|disk_usage|disk_free|swap_use|load_\d|last_boot)/;
  const SYSTEM_MONITOR_PREFIX = /^System Monitor\s+/i;
  const OUTDOOR_RE = /(outdoor|outside|exterior|garden|yard|patio|balcony|terrace|porch|driveway)/i;
  const PRODUCER_RE = /(solar|pv_|_pv|production|producing|export|inverter|generation|battery_(dis)?charg)/i;
  const MAIN_POWER_RE = /(total|grid|house|home|main|whole|consumption|import|mains)/i;
  const POWER_UNITS = new Set(['mW', 'W', 'kW', 'MW']);
  const PERCENT_GAUGE_CLASSES = new Set(['humidity', 'moisture']);
  const ACCUMULATING = new Set(['total', 'total_increasing']);

  /** Builds lookup maps from the area, entity and device registries (any of them may be missing). */
  HB.buildRegistry = ({ areas, entities, devices } = {}) => {
    const areaNames = new Map((areas || []).map((area) => [area.area_id, area.name]));
    const deviceAreas = new Map((devices || []).map((device) => [device.id, device.area_id]));
    const categories = (entities && entities.entity_categories) || {};
    const map = new Map();
    for (const entry of (entities && entities.entities) || []) {
      map.set(entry.ei, {
        areaId: entry.ai || (entry.di && deviceAreas.get(entry.di)) || null,
        category: entry.ec != null ? categories[entry.ec] || 'diagnostic' : null,
        hidden: Boolean(entry.hb),
        platform: entry.pl || null,
        precision: Number.isInteger(entry.dp) ? entry.dp : null,
        name: entry.en || null,
      });
    }
    return { entities: map, areaNames };
  };

  HB.emptyRegistry = () => HB.buildRegistry();

  /** Display precision configured for an entity, if any. */
  HB.precisionOf = (ctx, entityId) => ctx.registry.entities.get(entityId)?.precision ?? null;

  HB.areaIdOf = (ctx, entityId) => ctx.registry.entities.get(entityId)?.areaId || null;

  HB.areaNameOf = (ctx, entityId) => {
    const areaId = HB.areaIdOf(ctx, entityId);
    return areaId ? ctx.registry.areaNames.get(areaId) || '' : '';
  };

  /** Friendly name with a leading area name removed, since the tile shows the area separately. */
  HB.displayName = (ctx, st) => {
    let full = st.attributes.friendly_name || HB.humanize(HB.objectId(st.entity_id));
    if (ctx.registry.entities.get(st.entity_id)?.platform === 'systemmonitor' || SYSTEM_ID_RE.test(st.entity_id)) {
      full = full.replace(SYSTEM_MONITOR_PREFIX, '') || full;
    }
    const area = HB.areaNameOf(ctx, st.entity_id);
    if (area && full.length > area.length + 1 && full.toLowerCase().startsWith(`${area.toLowerCase()} `)) {
      const rest = full.slice(area.length + 1);
      return rest.charAt(0).toUpperCase() + rest.slice(1);
    }
    return full;
  };

  HB.isOutdoor = (ctx, st) =>
    OUTDOOR_RE.test(HB.areaNameOf(ctx, st.entity_id)) ||
    OUTDOOR_RE.test(st.entity_id) ||
    OUTDOOR_RE.test(st.attributes.friendly_name || '');

  /** True for numeric-looking sensors, including ones that are momentarily unavailable. */
  function isNumericLike(st) {
    if (HB.isNumeric(st.state)) return true;
    return HB.isOffline(st) && Boolean(st.attributes.unit_of_measurement || st.attributes.state_class);
  }

  HB.isPowerSensor = (st) =>
    HB.domainOf(st.entity_id) === 'sensor' &&
    (st.attributes.device_class === 'power' || POWER_UNITS.has(st.attributes.unit_of_measurement));

  HB.isAccumulating = (st) => ACCUMULATING.has(st.attributes.state_class);

  HB.isAlert = (st) => {
    const domain = HB.domainOf(st.entity_id);
    if (domain === 'binary_sensor') return st.state === 'on' && ALERT_CLASSES.has(st.attributes.device_class);
    if (domain === 'alarm_control_panel') return st.state === 'triggered';
    return false;
  };

  HB.isBattery = (st) =>
    HB.domainOf(st.entity_id) === 'sensor' && st.attributes.device_class === 'battery' && st.attributes.unit_of_measurement === '%';

  function isSystem(st, reg) {
    return (reg && reg.platform === 'systemmonitor') || SYSTEM_ID_RE.test(st.entity_id);
  }

  function classifySensor(st, reg) {
    const a = st.attributes;
    const dc = a.device_class;
    const unit = a.unit_of_measurement || '';
    const numeric = isNumericLike(st);
    if (isSystem(st, reg)) return { section: 'system', kind: numeric ? (unit === '%' ? 'gauge' : 'stat') : 'text' };
    if (HB.isBattery(st)) return { section: 'batteries', kind: 'battery', size: 'row' };
    if (!numeric) return { section: 'sensors', kind: 'text' };
    if (dc === 'temperature' || unit === '°C' || unit === '°F') return { section: 'climate', kind: 'stat' };
    if (PERCENT_GAUGE_CLASSES.has(dc) && unit === '%') return { section: 'climate', kind: 'gauge' };
    if (ENERGY_CLASSES.has(dc) || POWER_UNITS.has(unit) || /Wh$/.test(unit)) return { section: 'energy', kind: 'stat' };
    if (ATMOSPHERE_CLASSES.has(dc) || unit === 'UV index') return { section: 'atmosphere', kind: 'stat' };
    return { section: 'sensors', kind: 'stat' };
  }

  function classifyBinary(st) {
    const dc = st.attributes.device_class;
    return { section: SECURITY_CLASSES.has(dc) ? 'security' : 'sensors', kind: 'binary' };
  }

  /** Decides which section and tile type an entity gets, or null when it has no tile of its own. */
  function classify(st, reg) {
    const domain = HB.domainOf(st.entity_id);
    if (domain === 'sensor') return classifySensor(st, reg);
    if (domain === 'binary_sensor') return classifyBinary(st);
    if (domain === 'light') return { section: 'lighting', kind: 'light' };
    if (domain === 'climate') return { section: 'climate', kind: 'climate', size: 'l' };
    if (domain === 'lock') return { section: 'security', kind: 'lock' };
    if (domain === 'alarm_control_panel') return { section: 'security', kind: 'alarm' };
    if (domain === 'camera') return { section: 'cameras', kind: 'camera', size: 'l' };
    if (domain === 'media_player') return { section: 'media', kind: 'media', size: 'w' };
    if (domain === 'scene') return { section: 'scenes', kind: 'scene', size: 'chip' };
    if (domain === 'cover') return { section: 'controls', kind: 'cover' };
    if (domain === 'switch' || domain === 'input_boolean' || domain === 'fan') return { section: 'controls', kind: 'toggle' };
    if (CONTROL_DOMAINS.has(domain)) return { section: 'controls', kind: 'status' };
    return null;
  }

  /** Compiles include/exclude globs from the optional config file. */
  HB.compileFilters = (config) => ({
    include: (config.include || []).map(HB.globToRegExp),
    exclude: (config.exclude || []).map(HB.globToRegExp),
  });

  /**
   * Entities hidden in Home Assistant, diagnostic/config entities and excluded ones get no tile.
   * Battery levels and pending updates are kept even when an integration files them as diagnostic.
   */
  function isVisible(st, ctx) {
    const id = st.entity_id;
    if (ctx.filters.include.some((re) => re.test(id))) return true;
    if (ctx.filters.exclude.some((re) => re.test(id))) return false;
    const reg = ctx.registry.entities.get(id);
    if (reg && reg.hidden) return false;
    if (reg && reg.category && !HB.isBattery(st) && HB.domainOf(id) !== 'update') return false;
    return !st.attributes.hidden;
  }

  function byWatts(st) {
    return HB.toWatts(st.state, st.attributes.unit_of_measurement || 'W') ?? -Infinity;
  }

  function pickMainPower(candidates, config) {
    const configured = config.powerSensor && candidates.find((st) => st.entity_id === config.powerSensor);
    if (configured) return configured.entity_id;
    const consumers = candidates.filter((st) => !PRODUCER_RE.test(st.entity_id));
    if (!consumers.length) return null;
    const named = consumers.filter((st) => MAIN_POWER_RE.test(st.entity_id) || MAIN_POWER_RE.test(st.attributes.friendly_name || ''));
    const pool = named.length ? named : consumers;
    return pool.reduce((best, st) => (byWatts(st) > byWatts(best) ? st : best)).entity_id;
  }

  /** Home-wide facts used by the overview tiles and the header: alerts, power, presence, weather. */
  HB.derive = (states, ctx) => {
    const derived = {
      weatherId: null, sunId: null, personIds: [], mainPowerId: null, consumerIds: [], indoorTempIds: [],
      indoorHumidityIds: [], alerts: [], lowBatteries: [], updates: [], offline: 0,
    };
    const powerSensors = [];
    const weatherIds = [];
    for (const st of states.values()) {
      if (!isVisible(st, ctx)) continue;
      const domain = HB.domainOf(st.entity_id);
      if (HB.isOffline(st)) derived.offline += 1;
      if (domain === 'weather') weatherIds.push(st.entity_id);
      else if (domain === 'sun') derived.sunId = st.entity_id;
      else if (domain === 'person') derived.personIds.push(st.entity_id);
      else if (domain === 'update' && st.state === 'on') derived.updates.push(st.entity_id);
      else if (HB.isAlert(st)) derived.alerts.push(st.entity_id);
      else if (HB.isBattery(st) && HB.isNumeric(st.state) && Number(st.state) < LOW_BATTERY) derived.lowBatteries.push(st.entity_id);
      if (domain !== 'sensor' || !HB.isNumeric(st.state) || isSystem(st, ctx.registry.entities.get(st.entity_id))) continue;
      if (HB.isPowerSensor(st)) powerSensors.push(st);
      const dc = st.attributes.device_class;
      if (!HB.isOutdoor(ctx, st)) {
        if (dc === 'temperature') derived.indoorTempIds.push(st.entity_id);
        if (dc === 'humidity') derived.indoorHumidityIds.push(st.entity_id);
      }
    }
    const configuredWeather = ctx.config.weather && weatherIds.includes(ctx.config.weather) ? ctx.config.weather : null;
    derived.weatherId = configuredWeather || weatherIds.sort()[0] || null;
    derived.personIds.sort();
    derived.mainPowerId = pickMainPower(powerSensors, ctx.config);
    derived.consumerIds = powerSensors
      .filter((st) => st.entity_id !== derived.mainPowerId && !PRODUCER_RE.test(st.entity_id) && byWatts(st) > 0.5)
      .sort((a, b) => byWatts(b) - byWatts(a))
      .map((st) => st.entity_id);
    derived.lowBatteries.sort((a, b) => Number(states.get(a).state) - Number(states.get(b).state));
    return derived;
  };

  function sortKey(ctx, st) {
    return `${HB.areaNameOf(ctx, st.entity_id) || '￿'}\u0000${HB.displayName(ctx, st).toLowerCase()}`;
  }

  function overviewItems(derived) {
    const items = [];
    if (derived.weatherId) items.push({ id: '@weather', kind: 'weather', size: 'l', section: 'pulse' });
    if (derived.mainPowerId) items.push({ id: '@power', kind: 'power', size: 'l', section: 'pulse' });
    if (derived.indoorTempIds.length) items.push({ id: '@indoor', kind: 'indoor', size: 'w', section: 'pulse' });
    if (derived.personIds.length) items.push({ id: '@presence', kind: 'presence', size: 'w', section: 'pulse' });
    return items;
  }

  /**
   * Builds the dashboard layout: ordered sections with their tiles, filtered by the selected area.
   * Also reports which areas have at least one tile, for the area tabs.
   */
  HB.buildLayout = (states, ctx) => {
    const buckets = new Map(HB.SECTIONS.map((section) => [section.id, []]));
    const areasWithTiles = new Set();
    const hiddenSections = new Set(ctx.config.hideSections || []);
    const area = ctx.settings.area;
    for (const st of states.values()) {
      if (!isVisible(st, ctx)) continue;
      if (st.entity_id === ctx.derived.mainPowerId) continue;
      if (HB.isOffline(st) && !ctx.settings.showUnavailable) continue;
      const reg = ctx.registry.entities.get(st.entity_id);
      const info = classify(st, reg);
      if (!info || hiddenSections.has(info.section)) continue;
      const areaId = reg?.areaId || null;
      if (areaId) areasWithTiles.add(areaId);
      if (area !== 'all' && areaId !== area) continue;
      buckets.get(info.section).push({ id: st.entity_id, kind: info.kind, size: info.size || 's', section: info.section, sort: sortKey(ctx, st) });
    }
    if (area === 'all' && !hiddenSections.has('pulse')) buckets.set('pulse', overviewItems(ctx.derived));
    const sections = [];
    for (const meta of HB.SECTIONS) {
      const items = buckets.get(meta.id);
      if (!items.length) continue;
      if (meta.id !== 'pulse') items.sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
      sections.push({ ...meta, items });
    }
    return { sections, areasWithTiles };
  };

  /** One-line status shown next to each section title. */
  HB.sectionSummary = (section, states, ctx) => {
    const entities = section.items.map((item) => states.get(item.id)).filter(Boolean);
    const count = (predicate) => entities.filter(predicate).length;
    switch (section.id) {
      case 'lighting': return `${count((st) => st.state === 'on')} of ${entities.length} on`;
      case 'controls': return `${count((st) => st.state === 'on' || st.state === 'open')} active`;
      case 'security': {
        const alerts = count(HB.isAlert);
        if (alerts) return `${alerts} alert${alerts > 1 ? 's' : ''}`;
        const open = count((st) => st.state === 'on' || st.state === 'unlocked' || st.state === 'open');
        return open ? `${open} open or active` : 'All secure';
      }
      case 'climate': {
        const temps = entities.filter((st) => st.attributes.device_class === 'temperature' && HB.isNumeric(st.state) && !HB.isOutdoor(ctx, st));
        if (!temps.length) return '';
        const avg = temps.reduce((sum, st) => sum + Number(st.state), 0) / temps.length;
        return `avg ${HB.formatNumber(avg, 1)}${temps[0].attributes.unit_of_measurement || ''}`;
      }
      case 'media': {
        const playing = count((st) => st.state === 'playing');
        return playing ? `${playing} playing` : 'Idle';
      }
      case 'batteries': {
        const low = count((st) => HB.isNumeric(st.state) && Number(st.state) < LOW_BATTERY);
        return low ? `${low} low` : `All above ${LOW_BATTERY}%`;
      }
      case 'system': {
        const updates = ctx.derived.updates.length;
        return updates ? `${updates} update${updates > 1 ? 's' : ''} available` : 'Up to date';
      }
      default: return '';
    }
  };
})(window.HB = window.HB || {});
