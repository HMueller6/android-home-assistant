/* Habitat — line icons (24px grid, stroked) and the entity-to-icon mapping. */
(function (HB) {
  'use strict';

  const CLOUD_HIGH = 'M7 15h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 8 3.5 3.5 0 0 0 7 15Z';
  const FAN_BLADE = 'M12 10.2c-.6-3 .4-6.4 3-6.4 2.1 0 2.4 3.2-3 6.4Z';

  const ICONS = {
    sensor: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3"/>',
    thermometer: '<path d="M10 13.76V5a2 2 0 0 1 4 0v8.76a4 4 0 1 1-4 0Z"/><path d="M12 16.5V9"/>',
    droplet: '<path d="M12 3.5s-6 6.6-6 10.8a6 6 0 0 0 12 0C18 10.1 12 3.5 12 3.5Z"/>',
    bolt: '<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6l1-8Z"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z"/>',
    power: '<path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>',
    fan: `<circle cx="12" cy="12" r="1.8"/><path d="${FAN_BLADE}"/><path d="${FAN_BLADE}" transform="rotate(120 12 12)"/><path d="${FAN_BLADE}" transform="rotate(240 12 12)"/>`,
    flame: '<path d="M12 21a6 6 0 0 0 6-6c0-4.2-3-6.3-4-9.5-1.2 2.2-2 3.2-3 3.5 0-2-1-3.5-1-3.5C8 8.5 6 11 6 15a6 6 0 0 0 6 6Z"/>',
    snowflake: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 6l2.5-1.5M9.5 19.5 12 18l2.5 1.5"/>',
    door: '<path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M4 21h16"/><circle class="f" cx="14.5" cy="12" r="1"/>',
    doorOpen: '<path d="M4 21h16M6 21V3.8l8-1.3v19M14 4h4v17"/><circle class="f" cx="11.5" cy="12" r="1"/>',
    window: '<path d="M5 3h14v18H5zM12 3v18M5 12h14"/>',
    garage: '<path d="M3 21V9l9-5 9 5v12M7 21v-9h10v9M7 15h10M7 18h10"/>',
    motion: '<circle cx="12" cy="12" r="1.6"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>',
    shield: '<path d="M12 3 5 6v5c0 4.5 3 8.4 7 10 4-1.6 7-5.5 7-10V6l-7-3Z"/>',
    shieldCheck: '<path d="M12 3 5 6v5c0 4.5 3 8.4 7 10 4-1.6 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
    lock: '<path d="M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11M12 15v2"/>',
    unlock: '<path d="M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 6.8-1.2M12 15v2"/>',
    battery: '<path d="M3 8h15v8H3zM21 11v2"/>',
    cpu: '<path d="M7 7h10v10H7zM10 10h4v4h-4zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/>',
    cloud: '<path d="M7 18h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 11 3.5 3.5 0 0 0 7 18Z"/>',
    cloudSun: '<path d="M8 3.5V5M3.5 8H5M4.8 4.8l1 1M11.2 4.8l-1 1M5.6 10.6A3 3 0 0 1 10.9 8"/><path d="M9 20h8.5a3.5 3.5 0 0 0 .5-6.96A5 5 0 0 0 8.6 13.5 3.25 3.25 0 0 0 9 20Z"/>',
    rain: `<path d="${CLOUD_HIGH}"/><path d="m8.5 18-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5"/>`,
    snow: `<path d="${CLOUD_HIGH}"/><circle class="f" cx="8" cy="19" r="1"/><circle class="f" cx="12" cy="20.5" r="1"/><circle class="f" cx="16" cy="19" r="1"/>`,
    storm: `<path d="${CLOUD_HIGH}"/><path d="m12.5 15.5-2 3.2h3l-2 3.3"/>`,
    fog: '<path d="M7 5h10M4 9h16M6 13h14M4 17h12M9 21h8"/>',
    wind: '<path d="M3 8h10a2.5 2.5 0 1 0-2.5-2.5M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
    play: '<path class="f" d="M8 5.5v13l10.5-6.5L8 5.5Z"/>',
    pause: '<path class="f" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>',
    next: '<path class="f" d="m6 6 9 6-9 6V6Z"/><path d="M18 6v12"/>',
    prev: '<path class="f" d="m18 6-9 6 9 6V6Z"/><path d="M6 6v12"/>',
    home: '<path d="M3.5 11 12 4l8.5 7M6 9.5V20h12V9.5M10 20v-5h4v5"/>',
    pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
    camera: '<path d="M3 7h12v10H3zM15 10.5 21 7v10l-6-3.5"/>',
    sparkle: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7L19 16Z"/>',
    alert: '<path d="M12 3.5 2.5 20h19L12 3.5ZM12 10v4.5"/><circle class="f" cx="12" cy="17.3" r="1"/>',
    wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0"/><circle class="f" cx="12" cy="19.3" r="1"/>',
    gauge: '<path d="M4.5 17a8.5 8.5 0 1 1 15 0M12 13l4-4"/><circle cx="12" cy="13" r="1.2"/>',
    leaf: '<path d="M5 19c0-9 6-14 15-14 0 9-5 14-13 14M5 19c3-4 6-6.5 9.5-8"/>',
    blinds: '<path d="M4 3h16M5 3v13M19 3v13M5 7h14M5 11h14M5 15h14M12 16v3"/><circle cx="12" cy="20.5" r="1.3"/>',
    plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v4"/>',
    smoke: '<path d="M4 5h16l-2 4H6L4 5Z"/><path d="M8 13c1 1 0 2 1 3s0 2 1 3M12 13c1 1 0 2 1 3s0 2 1 3M16 13c1 1 0 2 1 3s0 2 1 3"/>',
    sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    chevronUp: '<path d="m6 15 6-6 6 6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    stop: '<path d="M7 7h10v10H7z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    tv: '<path d="M3 5h18v12H3zM8 21h8M12 17v4"/>',
    speaker: '<path d="M7 3h10v18H7z"/><circle cx="12" cy="14" r="3"/><circle class="f" cx="12" cy="7" r="1"/>',
    vacuum: '<circle cx="12" cy="12" r="8.5"/><path d="M8 9h8"/><circle cx="12" cy="14" r="1.6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle class="f" cx="12" cy="8" r="1"/>',
    user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
    water: '<path d="M3 15c2 0 2-1.5 4.5-1.5S9.5 15 12 15s2-1.5 4.5-1.5S18.5 15 21 15M3 19c2 0 2-1.5 4.5-1.5S9.5 19 12 19s2-1.5 4.5-1.5S18.5 19 21 19"/><path d="M12 3s-3 3.3-3 5.4a3 3 0 0 0 6 0C15 6.3 12 3 12 3Z"/>',
    signal: '<path d="M4 20v-3M9 20v-7M14 20V9M19 20V4"/>',
    update: '<path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/>',
    sunrise: '<path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 4v5M9 7l3-3 3 3M4.9 10.9l1.4 1.4M19.1 10.9l-1.4 1.4"/>',
    sunset: '<path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 4v5M9 6l3 3 3-3M4.9 10.9l1.4 1.4M19.1 10.9l-1.4 1.4"/>',
  };

  /** Returns an inline SVG icon by name; unknown names fall back to the generic sensor glyph. */
  HB.icon = (name, cls = '') =>
    `<svg class="ic${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ICONS.sensor}</svg>`;

  const SENSOR_ICONS = {
    temperature: 'thermometer', humidity: 'droplet', moisture: 'droplet', power: 'bolt', energy: 'bolt',
    voltage: 'bolt', current: 'bolt', apparent_power: 'bolt', reactive_power: 'bolt', power_factor: 'bolt',
    battery: 'battery', carbon_dioxide: 'leaf', carbon_monoxide: 'smoke', pm1: 'leaf', pm25: 'leaf', pm10: 'leaf',
    volatile_organic_compounds: 'leaf', volatile_organic_compounds_parts: 'leaf', nitrogen_dioxide: 'leaf',
    ozone: 'leaf', aqi: 'leaf', pressure: 'gauge', atmospheric_pressure: 'gauge', illuminance: 'sun',
    irradiance: 'sun', wind_speed: 'wind', precipitation: 'rain', precipitation_intensity: 'rain',
    signal_strength: 'signal', data_rate: 'signal', data_size: 'signal', gas: 'flame', water: 'water',
    timestamp: 'update', sound_pressure: 'speaker',
  };

  const BINARY_ICONS = {
    door: ['door', 'doorOpen'], garage_door: ['garage', 'garage'], window: ['window', 'window'], opening: ['door', 'doorOpen'],
    motion: ['motion', 'motion'], occupancy: ['user', 'user'], presence: ['home', 'home'], moving: ['motion', 'motion'],
    smoke: ['smoke', 'smoke'], gas: ['flame', 'flame'], carbon_monoxide: ['smoke', 'smoke'], moisture: ['droplet', 'water'],
    problem: ['shieldCheck', 'alert'], safety: ['shieldCheck', 'alert'], tamper: ['shieldCheck', 'alert'],
    heat: ['thermometer', 'flame'], cold: ['thermometer', 'snowflake'], connectivity: ['wifi', 'wifi'],
    plug: ['plug', 'plug'], power: ['power', 'bolt'], battery: ['battery', 'battery'], battery_charging: ['battery', 'bolt'],
    lock: ['lock', 'unlock'], light: ['moon', 'sun'], sound: ['speaker', 'speaker'], vibration: ['motion', 'motion'],
    running: ['power', 'power'], update: ['update', 'update'],
  };

  const WEATHER_ICONS = {
    'clear-night': 'moon', cloudy: 'cloud', exceptional: 'alert', fog: 'fog', hail: 'snow', lightning: 'storm',
    'lightning-rainy': 'storm', partlycloudy: 'cloudSun', pouring: 'rain', rainy: 'rain', snowy: 'snow',
    'snowy-rainy': 'snow', sunny: 'sun', windy: 'wind', 'windy-variant': 'wind',
  };

  HB.weatherIcon = (condition) => WEATHER_ICONS[condition] || 'cloud';

  const SYSTEM_RE = /(processor|cpu|memory|disk|swap|load_\d|_load|network_|throughput)/;

  /** Picks the icon that best describes an entity from its domain, device class and state. */
  HB.entityIconName = (st) => {
    const domain = HB.domainOf(st.entity_id);
    const a = st.attributes || {};
    const dc = a.device_class;
    switch (domain) {
      case 'sensor':
        if (SENSOR_ICONS[dc]) return SENSOR_ICONS[dc];
        if (SYSTEM_RE.test(st.entity_id)) return 'cpu';
        return a.unit_of_measurement === '%' ? 'gauge' : 'sensor';
      case 'binary_sensor': {
        const pair = BINARY_ICONS[dc] || ['sensor', 'sensor'];
        return st.state === 'on' ? pair[1] : pair[0];
      }
      case 'light': return 'bulb';
      case 'switch': return dc === 'outlet' ? 'plug' : 'power';
      case 'input_boolean': return 'power';
      case 'fan': return 'fan';
      case 'climate': return a.hvac_action === 'cooling' ? 'snowflake' : a.hvac_action === 'heating' ? 'flame' : 'thermometer';
      case 'cover': return dc === 'garage' || dc === 'gate' ? 'garage' : dc === 'door' ? 'door' : 'blinds';
      case 'lock': return st.state === 'locked' ? 'lock' : 'unlock';
      case 'alarm_control_panel': return 'shield';
      case 'media_player': return dc === 'tv' ? 'tv' : dc === 'speaker' ? 'speaker' : 'music';
      case 'camera': return 'camera';
      case 'scene': case 'script': return 'sparkle';
      case 'vacuum': case 'lawn_mower': return 'vacuum';
      case 'water_heater': return 'flame';
      case 'humidifier': return 'droplet';
      case 'valve': return 'water';
      case 'weather': return HB.weatherIcon(st.state);
      case 'person': case 'device_tracker': return 'user';
      case 'update': return 'update';
      default: return 'sensor';
    }
  };
})(window.HB = window.HB || {});
