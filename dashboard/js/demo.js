/*
 * Habitat — demo backend. Simulates a Home Assistant instance (open with ?demo) so the dashboard
 * can be tried and developed without a server. It speaks the same WebSocket message shapes the
 * real backend returns, so the rest of the app runs exactly the same code path.
 */
(function (HB) {
  'use strict';

  const { MINUTE, HOUR, DAY } = HB.MS;
  const TICK_MS = 3000;
  const DEMO_VERSION = '2026.11.0';
  const BOOT = Date.now();

  // ---- Deterministic signal helpers, so history and live values agree -------------------------

  function hash(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  /** Smooth value noise in [-1, 1] with knots every `period` ms. */
  function smooth(seed, t, period) {
    const k = t / period;
    const i = Math.floor(k);
    const f = (1 - Math.cos((k - i) * Math.PI)) / 2;
    const a = hash(seed * 1000 + i);
    const b = hash(seed * 1000 + i + 1);
    return (a + (b - a) * f) * 2 - 1;
  }

  function jitter(seed, t, amplitude) {
    return (hash(seed * 7.3 + Math.floor(t / TICK_MS)) * 2 - 1) * amplitude;
  }

  function hourOf(t) {
    const d = new Date(t);
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  }

  function daily(t, peakHour, amplitude) {
    return amplitude * Math.cos(((hourOf(t) - peakHour) / 24) * 2 * Math.PI);
  }

  function inWindow(t, windows) {
    const h = hourOf(t);
    return windows.some(([from, to]) => h >= from && h < to);
  }

  function daylight(t) {
    const h = hourOf(t);
    return h > 7.5 && h < 16.7 ? Math.sin((Math.PI * (h - 7.5)) / 9.2) : 0;
  }

  function startOfDay(t) {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function atHour(dayStart, hour) {
    return dayStart + hour * HOUR;
  }

  /** Energy in kWh for a power function (watts) between two timestamps. */
  function integrate(powerFn, from, to, step = 10 * MINUTE) {
    let wattMs = 0;
    for (let t = from; t < to; t += step) wattMs += powerFn(t) * Math.min(step, to - t);
    return wattMs / 3.6e9;
  }

  // ---- The simulated home ---------------------------------------------------------------------

  const AREAS = [
    ['living_room', 'Living room'], ['kitchen', 'Kitchen'], ['bedroom', 'Bedroom'], ['office', 'Office'],
    ['hallway', 'Hallway'], ['bathroom', 'Bathroom'], ['garage', 'Garage'], ['garden', 'Garden'],
  ];

  const WASH = [9.5, 11.1];
  const OVEN = [17.6, 18.4];
  const SHOWER = [7, 7.6];

  const devicePower = {
    oven: (t) => (inWindow(t, [OVEN]) ? 2050 + jitter(11, t, 60) : 0),
    washer: (t) => {
      if (!inWindow(t, [WASH])) return 1.2;
      const h = hourOf(t);
      if (h < 9.8) return 1900 + jitter(12, t, 80);
      if (h > 10.8) return 430 + jitter(12, t, 120);
      return 150 + 90 * Math.abs(smooth(12, t, 2 * MINUTE));
    },
    desk: (t) => (inWindow(t, [[8.5, 12.5], [13.25, 18]]) ? 128 + smooth(13, t, 10 * MINUTE) * 30 + jitter(13, t, 6) : 9),
    tv: (t) => (inWindow(t, [[19, 23.2]]) ? 92 + jitter(14, t, 4) : 0.6),
    rack: (t) => 41 + smooth(15, t, 20 * MINUTE) * 5 + jitter(15, t, 1.5),
    heatPump: (t) => Math.max(0, 520 + daily(t, 6.5, 260) + smooth(16, t, 30 * MINUTE) * 120 + jitter(16, t, 15)),
    fridge: (t) => (Math.floor(t / (20 * MINUTE)) % 3 === 0 ? 4 : 95 + jitter(17, t, 5)),
  };
  const basePower = (t) => 150 + Math.max(0, daily(t, 19.5, 1)) * 140 + smooth(18, t, 15 * MINUTE) * 30;
  const housePower = (t) => basePower(t) + Object.values(devicePower).reduce((sum, fn) => sum + fn(t), 0);
  const solarPower = (t) => Math.max(0, daylight(t) * (1450 + smooth(19, t, 25 * MINUTE) * 500));
  const livingTemp = (t) => 21.3 + daily(t, 18.5, 0.7) + smooth(1, t, 40 * MINUTE) * 0.25;
  const bedroomTemp = (t) => 19.2 + daily(t, 22, 0.5) + smooth(3, t, 50 * MINUTE) * 0.2;
  const outdoorTemp = (t) => 8.6 + daily(t, 14.5, 3.4) + smooth(8, t, HOUR) * 1.1;

  const W = { unit: 'W', dc: 'power', sc: 'measurement', digits: 0 };
  const C = { unit: '°C', dc: 'temperature', sc: 'measurement', digits: 1 };
  const RH = { unit: '%', dc: 'humidity', sc: 'measurement', digits: 0 };
  const SYS = { pl: 'systemmonitor', sc: 'measurement' };

  /** Numeric sensors: [entity_id, name, area, spec, value(t)]. */
  const NUMERIC = [
    ['sensor.living_room_temperature', 'Living room Temperature', 'living_room', C, livingTemp],
    ['sensor.kitchen_temperature', 'Kitchen Temperature', 'kitchen', C, (t) => 21.6 + daily(t, 19, 1.1) + (inWindow(t, [OVEN]) ? 1.2 : 0) + smooth(2, t, 40 * MINUTE) * 0.3],
    ['sensor.bedroom_temperature', 'Bedroom Temperature', 'bedroom', C, bedroomTemp],
    ['sensor.office_temperature', 'Office Temperature', 'office', C, (t) => 22 + daily(t, 15, 0.9) + smooth(4, t, 40 * MINUTE) * 0.3],
    ['sensor.bathroom_temperature', 'Bathroom Temperature', 'bathroom', C, (t) => 22.4 + (inWindow(t, [SHOWER]) ? 1.8 : 0) + smooth(5, t, 40 * MINUTE) * 0.3],
    ['sensor.hallway_temperature', 'Hallway Temperature', 'hallway', C, (t) => 19.8 + daily(t, 18, 0.4) + smooth(6, t, 60 * MINUTE) * 0.2],
    ['sensor.garage_temperature', 'Garage Temperature', 'garage', C, (t) => 12.6 + daily(t, 15, 1.8) + smooth(7, t, 60 * MINUTE) * 0.4],
    ['sensor.outdoor_temperature', 'Outdoor Temperature', 'garden', C, outdoorTemp],
    ['sensor.living_room_humidity', 'Living room Humidity', 'living_room', RH, (t) => 46 + smooth(21, t, HOUR) * 4],
    ['sensor.bedroom_humidity', 'Bedroom Humidity', 'bedroom', RH, (t) => 53 + smooth(22, t, HOUR) * 3],
    ['sensor.bathroom_humidity', 'Bathroom Humidity', 'bathroom', RH, (t) => Math.min(96, 61 + (inWindow(t, [SHOWER]) ? 24 : 0) + smooth(23, t, 30 * MINUTE) * 3)],
    ['sensor.outdoor_humidity', 'Outdoor Humidity', 'garden', RH, (t) => 79 - daily(t, 14.5, 9) + smooth(24, t, HOUR) * 4],
    ['sensor.house_power', 'House power', null, W, housePower],
    ['sensor.kitchen_oven_power', 'Kitchen Oven power', 'kitchen', W, devicePower.oven],
    ['sensor.washing_machine_power', 'Washing machine power', 'garage', W, devicePower.washer],
    ['sensor.office_desk_power', 'Office Desk power', 'office', W, devicePower.desk],
    ['sensor.living_room_tv_power', 'Living room TV power', 'living_room', W, devicePower.tv],
    ['sensor.network_rack_power', 'Network rack power', 'office', W, devicePower.rack],
    ['sensor.heat_pump_power', 'Heat pump power', 'garage', W, devicePower.heatPump],
    ['sensor.fridge_power', 'Kitchen Fridge power', 'kitchen', W, devicePower.fridge],
    ['sensor.solar_power', 'Solar power', 'garden', W, solarPower],
    ['sensor.energy_consumption_today', 'Energy consumption today', null, { unit: 'kWh', dc: 'energy', sc: 'total_increasing', digits: 2, rate: housePower }, (t) => integrate(housePower, startOfDay(t), t)],
    ['sensor.solar_energy_today', 'Solar energy today', 'garden', { unit: 'kWh', dc: 'energy', sc: 'total_increasing', digits: 2, rate: solarPower }, (t) => integrate(solarPower, startOfDay(t), t)],
    ['sensor.electricity_price', 'Electricity price', null, { unit: 'EUR/kWh', dc: 'monetary', digits: 3 }, (t) => 0.21 + Math.max(0, daily(t, 18.5, 0.09)) + smooth(25, t, 2 * HOUR) * 0.015],
    ['sensor.living_room_co2', 'Living room CO2', 'living_room', { unit: 'ppm', dc: 'carbon_dioxide', sc: 'measurement', digits: 0 }, (t) => 610 + Math.max(0, daily(t, 21, 1)) * 380 + smooth(26, t, 30 * MINUTE) * 40],
    ['sensor.living_room_pm25', 'Living room PM2.5', 'living_room', { unit: 'µg/m³', dc: 'pm25', sc: 'measurement', digits: 0 }, (t) => Math.max(1, 5 + (inWindow(t, [OVEN]) ? 18 : 0) + smooth(27, t, 30 * MINUTE) * 2)],
    ['sensor.outdoor_pressure', 'Outdoor Pressure', 'garden', { unit: 'hPa', dc: 'atmospheric_pressure', sc: 'measurement', digits: 0 }, (t) => 1014 + smooth(28, t, 6 * HOUR) * 7],
    ['sensor.garden_illuminance', 'Garden Illuminance', 'garden', { unit: 'lx', dc: 'illuminance', sc: 'measurement', digits: 0 }, (t) => daylight(t) * 14000 * (0.7 + 0.3 * smooth(29, t, 20 * MINUTE))],
    ['sensor.outdoor_uv_index', 'Outdoor UV index', 'garden', { unit: 'UV index', sc: 'measurement', digits: 1 }, (t) => daylight(t) * 1.6],
    ['sensor.internet_download_speed', 'Internet download speed', 'office', { unit: 'Mbit/s', dc: 'data_rate', sc: 'measurement', digits: 0 }, (t) => 180 + smooth(30, t, 20 * MINUTE) * 90],
    ['sensor.system_monitor_processor_use', 'System Monitor Processor use', null, { ...SYS, unit: '%', digits: 0 }, (t) => 12 + Math.abs(smooth(31, t, 15 * MINUTE)) * 16 + jitter(31, t, 3)],
    ['sensor.system_monitor_memory_usage', 'System Monitor Memory usage', null, { ...SYS, unit: '%', digits: 1 }, (t) => 58.3 + smooth(32, t, HOUR) * 3],
    ['sensor.system_monitor_disk_usage', 'System Monitor Disk usage', null, { ...SYS, unit: '%', digits: 1 }, (t) => 71.4 + (t - BOOT) / DAY * 0.1],
    ['sensor.system_monitor_processor_temperature', 'System Monitor Processor temperature', null, { ...SYS, unit: '°C', dc: 'temperature', digits: 1 }, (t) => 47 + smooth(33, t, 30 * MINUTE) * 5 + jitter(33, t, 0.6)],
    ['sensor.hallway_motion_battery', 'Hallway Motion battery', 'hallway', { unit: '%', dc: 'battery', digits: 0, ec: 1 }, () => 82],
    ['sensor.front_door_contact_battery', 'Front door Contact battery', 'hallway', { unit: '%', dc: 'battery', digits: 0, ec: 1 }, () => 64],
    ['sensor.bedroom_window_battery', 'Bedroom Window battery', 'bedroom', { unit: '%', dc: 'battery', digits: 0, ec: 1 }, () => 12],
    ['sensor.kitchen_smoke_battery', 'Kitchen Smoke detector battery', 'kitchen', { unit: '%', dc: 'battery', digits: 0, ec: 1 }, () => 91],
    ['sensor.living_room_remote_battery', 'Living room Remote battery', 'living_room', { unit: '%', dc: 'battery', digits: 0, ec: 1 }, () => 4],
    ['sensor.garden_weather_station_battery', 'Garden Weather station battery', 'garden', { unit: '%', dc: 'battery', digits: 0, ec: 1 }, () => 47],
    ['sensor.bathroom_leak_battery', 'Bathroom Leak sensor battery', 'bathroom', { unit: '%', dc: 'battery', digits: 0, ec: 1 }, () => 76],
    ['sensor.alex_phone_battery', "Alex's phone battery", null, { unit: '%', dc: 'battery', digits: 0 }, (t) => Math.max(5, 58 - ((t - BOOT) / HOUR) * 2)],
    ['sensor.living_room_tv_signal_strength', 'Living room TV signal strength', 'living_room', { unit: 'dBm', dc: 'signal_strength', digits: 0, ec: 1 }, (t) => -54 + smooth(34, t, 10 * MINUTE) * 4],
  ];

  /** On/off entities that follow a daily schedule: [entity_id, name, area, windows, attributes]. */
  const SCHEDULED = [
    ['light.living_room_ceiling', 'Living room Ceiling', 'living_room', [[6.8, 8.2], [16.6, 23.3]], { brightness: 184, rgb_color: [255, 196, 137] }],
    ['light.living_room_floor_lamp', 'Living room Floor lamp', 'living_room', [[19, 23.5]], { brightness: 102, rgb_color: [255, 147, 41] }],
    ['light.tv_ambilight', 'Living room TV ambilight', 'living_room', [[19, 23.2]], { brightness: 140, rgb_color: [124, 92, 255] }],
    ['light.kitchen_counter', 'Kitchen Counter', 'kitchen', [[6.7, 8.3], [17.3, 20.5]], { brightness: 255, rgb_color: [255, 232, 200] }],
    ['light.kitchen_island', 'Kitchen Island', 'kitchen', [[18, 19.5]], { brightness: 200, rgb_color: [255, 214, 170] }],
    ['light.bedroom_bedside', 'Bedroom Bedside', 'bedroom', [[6.6, 6.9], [22.5, 23.6]], { brightness: 60, rgb_color: [255, 170, 90] }],
    ['light.office_desk', 'Office Desk lamp', 'office', [[8.3, 12.4], [13.2, 18.2]], { brightness: 217, rgb_color: [214, 228, 255] }],
    ['light.hallway', 'Hallway Ceiling', 'hallway', [[6.9, 7.1], [17.9, 18.1], [22.9, 23.1]], { brightness: 255, rgb_color: [255, 240, 220] }],
    ['light.garden_path', 'Garden Path lights', 'garden', [[16.8, 23.5]], { brightness: 160, rgb_color: [255, 214, 150] }],
    ['switch.coffee_machine', 'Kitchen Coffee machine', 'kitchen', [[6.7, 7.4], [13, 13.3]], { device_class: 'outlet' }],
    ['switch.office_monitor', 'Office Monitor', 'office', [[8.3, 18.2]], { device_class: 'outlet' }],
    ['switch.garden_irrigation', 'Garden Irrigation', 'garden', [], {}],
    ['input_boolean.guest_mode', 'Guest mode', null, [], {}],
    ['fan.office_fan', 'Office Fan', 'office', [[11, 16]], { percentage: 40, percentage_step: 10, supported_features: 1 }],
    ['fan.bedroom_fan', 'Bedroom Ceiling fan', 'bedroom', [], { percentage: 0, percentage_step: 25, supported_features: 1 }],
    ['binary_sensor.front_door', 'Front door', 'hallway', [[8.05, 8.07], [12.5, 12.52], [17.75, 17.78]], { device_class: 'door' }],
    ['binary_sensor.back_door', 'Kitchen Back door', 'kitchen', [[18.9, 18.95]], { device_class: 'door' }],
    ['binary_sensor.living_room_presence', 'Living room Presence', 'living_room', [[6.8, 8.3], [17, 23.4]], { device_class: 'occupancy' }],
    ['binary_sensor.kitchen_smoke', 'Kitchen Smoke detector', 'kitchen', [], { device_class: 'smoke' }],
    ['binary_sensor.bathroom_leak', 'Bathroom Leak sensor', 'bathroom', [], { device_class: 'moisture' }],
    ['binary_sensor.washing_machine_running', 'Washing machine running', 'garage', [WASH], { device_class: 'running' }],
    ['binary_sensor.internet_connectivity', 'Internet', null, [[0, 24]], { device_class: 'connectivity' }],
  ];

  /** On/off entities that switched on shortly before the demo started and stay on. */
  const OPEN_SINCE = [
    ['binary_sensor.garage_door', 'Garage door', 'garage', 25 * MINUTE, { device_class: 'garage_door' }],
    ['binary_sensor.bedroom_window', 'Bedroom Window', 'bedroom', 42 * MINUTE, { device_class: 'window' }],
  ];

  const MOTION_ID = 'binary_sensor.hallway_motion';
  const MOTION_PERIOD = 4 * MINUTE;
  const MOTION_ON = 45 * 1000;

  const PLAYLIST = [
    { media_title: 'Afterglow Protocol', media_artist: 'Kaito Vance', media_album_name: 'Low Orbit', media_duration: 242 },
    { media_title: 'Signal Over Ice', media_artist: 'Mara Lindqvist', media_album_name: 'Polar Night Radio', media_duration: 205 },
    { media_title: 'Quiet Machines', media_artist: 'The Lattice', media_album_name: 'Servo Hymns', media_duration: 318 },
  ];

  const FORECAST = [
    ['partlycloudy', 11, 5, 20], ['rainy', 8, 4, 80], ['cloudy', 9, 3, 30],
    ['sunny', 12, 2, 5], ['windy', 10, 6, 15], ['rainy', 7, 3, 70], ['cloudy', 8, 2, 25],
  ];

  function nextAlarm(t) {
    const today = atHour(startOfDay(t), 6.75);
    return t < today ? today : atHour(startOfDay(t + DAY), 6.75);
  }

  function scheduledState(windows, t) {
    return inWindow(t, windows) ? 'on' : 'off';
  }

  function motionState(t) {
    return inWindow(t, [[6.5, 23.5]]) && t % MOTION_PERIOD < MOTION_ON ? 'on' : 'off';
  }

  function windowTransitions(windows, start, end) {
    const out = [[start, scheduledState(windows, start)]];
    for (let day = startOfDay(start); day <= end; day = startOfDay(day + 36 * HOUR)) {
      for (const [from, to] of windows) {
        const on = atHour(day, from);
        const off = atHour(day, to);
        if (from > 0 && on > start && on <= end) out.push([on, 'on']);
        if (to < 24 && off > start && off <= end) out.push([off, 'off']);
      }
    }
    return out.sort((a, b) => a[0] - b[0]);
  }

  function motionTransitions(start, end) {
    const out = [[start, motionState(start)]];
    for (let t = Math.ceil(start / MOTION_PERIOD) * MOTION_PERIOD; t <= end; t += MOTION_PERIOD) {
      if (motionState(t) === 'on') {
        out.push([t, 'on']);
        if (t + MOTION_ON <= end) out.push([t + MOTION_ON, 'off']);
      }
    }
    return out;
  }

  function collapse(transitions) {
    const out = [];
    for (const entry of transitions) {
      if (!out.length || out[out.length - 1][1] !== entry[1]) out.push(entry);
    }
    return out;
  }

  // ---- Simulation -----------------------------------------------------------------------------

  function createSimulation() {
    const states = new Map();
    const registry = [];
    const numeric = new Map();
    const schedules = new Map();
    const changeLog = new Map();
    const overridden = new Set();
    const lightMemory = new Map();
    const subscribers = new Set();
    let mediaIndex = 0;

    function add(id, state, attributes, regEntry, changedAt = BOOT) {
      states.set(id, { entity_id: id, state, attributes, last_changed: changedAt, last_updated: changedAt });
      registry.push({ ei: id, ...regEntry });
    }

    function areaEntry(area, extra = {}) {
      return area ? { ai: area, ...extra } : { ...extra };
    }

    for (const [id, name, area, spec, fn] of NUMERIC) {
      numeric.set(id, { spec, fn });
      const attributes = { friendly_name: name, unit_of_measurement: spec.unit };
      if (spec.dc) attributes.device_class = spec.dc;
      if (spec.sc) attributes.state_class = spec.sc;
      const extra = {};
      if (spec.pl) extra.pl = spec.pl;
      if (spec.ec != null) extra.ec = spec.ec;
      add(id, fn(BOOT).toFixed(spec.digits), attributes, areaEntry(area, extra));
    }

    for (const [id, name, area, windows, extra] of SCHEDULED) {
      schedules.set(id, (start, end) => windowTransitions(windows, start, end));
      const state = scheduledState(windows, BOOT);
      const history = collapse(windowTransitions(windows, BOOT - 3 * DAY, BOOT));
      const changedAt = history[history.length - 1][0];
      const attributes = { friendly_name: name, ...extra };
      if (id.startsWith('light.')) {
        attributes.supported_color_modes = ['rgb'];
        attributes.color_mode = state === 'on' ? 'rgb' : null;
        lightMemory.set(id, { brightness: extra.brightness, rgb_color: extra.rgb_color });
        if (state !== 'on') Object.assign(attributes, { brightness: null, rgb_color: null });
      }
      if (id.startsWith('fan.') && state !== 'on') attributes.percentage = 0;
      add(id, state, attributes, areaEntry(area), changedAt);
    }

    for (const [id, name, area, ago, extra] of OPEN_SINCE) {
      const since = BOOT - ago;
      schedules.set(id, (start, end) => (since > start ? [[start, 'off'], [since, 'on']] : [[start, 'on']]).filter(([t]) => t <= end));
      add(id, 'on', { friendly_name: name, ...extra }, areaEntry(area), since);
    }

    schedules.set(MOTION_ID, motionTransitions);
    const motionHistory = motionTransitions(BOOT - DAY, BOOT);
    add(MOTION_ID, motionState(BOOT), { friendly_name: 'Hallway Motion', device_class: 'motion' }, areaEntry('hallway'), motionHistory[motionHistory.length - 1][0]);

    const climate = (name, current, target) => ({
      friendly_name: name, hvac_modes: ['off', 'heat', 'auto'], min_temp: 7, max_temp: 30, target_temp_step: 0.5,
      current_temperature: Number(current.toFixed(1)), temperature: target,
      hvac_action: current < target - 0.1 ? 'heating' : 'idle', supported_features: 1,
    });
    add('climate.living_room', 'heat', climate('Living room Thermostat', livingTemp(BOOT), 21.5), areaEntry('living_room'));
    add('climate.bedroom', 'heat', climate('Bedroom Thermostat', bedroomTemp(BOOT), 19), areaEntry('bedroom'));
    add('cover.living_room_blinds', 'open', { friendly_name: 'Living room Blinds', current_position: 70, device_class: 'blind', supported_features: 15 }, areaEntry('living_room'));
    add('cover.office_shades', 'closed', { friendly_name: 'Office Shades', current_position: 0, device_class: 'shade', supported_features: 15 }, areaEntry('office'));
    add('lock.front_door', 'locked', { friendly_name: 'Front door Lock', supported_features: 0 }, areaEntry('hallway'));
    add('alarm_control_panel.home_alarm', 'armed_home', { friendly_name: 'Home alarm', code_arm_required: true, supported_features: 63 }, {});
    add('media_player.living_room_speaker', 'playing', {
      friendly_name: 'Living room Speaker', device_class: 'speaker', volume_level: 0.35, is_volume_muted: false,
      app_name: 'Music', media_content_type: 'music', ...PLAYLIST[0], media_position: 87,
      media_position_updated_at: new Date(BOOT).toISOString(), supported_features: 152463,
    }, areaEntry('living_room'));
    add('media_player.kitchen_display', 'idle', { friendly_name: 'Kitchen Display', device_class: 'speaker', volume_level: 0.2, supported_features: 152463 }, areaEntry('kitchen'));
    add('media_player.bedroom_tv', 'off', { friendly_name: 'Bedroom TV', device_class: 'tv', supported_features: 21437 }, areaEntry('bedroom'));
    for (const [id, name] of [['scene.good_morning', 'Good morning'], ['scene.movie_night', 'Movie night'], ['scene.dinner', 'Dinner'], ['scene.goodnight', 'Goodnight']]) {
      add(id, new Date(BOOT - 5 * HOUR).toISOString(), { friendly_name: name }, {});
    }
    add('vacuum.robot_vacuum', 'docked', { friendly_name: 'Robot vacuum', battery_level: 100, fan_speed: 'balanced', supported_features: 14204 }, areaEntry('living_room'));
    add('sensor.washing_machine_status', 'Idle', { friendly_name: 'Washing machine status', device_class: 'enum' }, areaEntry('garage'));
    add('sensor.alex_phone_next_alarm', new Date(nextAlarm(BOOT)).toISOString(), { friendly_name: "Alex's phone Next alarm", device_class: 'timestamp' }, {});
    add('weather.home', 'partlycloudy', {
      friendly_name: 'Home', temperature: Number(outdoorTemp(BOOT).toFixed(1)), apparent_temperature: Number((outdoorTemp(BOOT) - 2.3).toFixed(1)),
      humidity: 78, pressure: 1014, wind_speed: 14.4, wind_bearing: 225, temperature_unit: '°C', pressure_unit: 'hPa',
      wind_speed_unit: 'km/h', visibility_unit: 'km', precipitation_unit: 'mm', supported_features: 3,
    }, {});
    add('sun.sun', daylight(BOOT) > 0 ? 'above_horizon' : 'below_horizon', sunAttributes(BOOT), {});
    add('person.alex', 'home', { friendly_name: 'Alex', source: 'device_tracker.alex_phone' }, {});
    add('person.sam', 'Work', { friendly_name: 'Sam', source: 'device_tracker.sam_phone' }, {});
    add('person.robin', 'not_home', { friendly_name: 'Robin', source: 'device_tracker.robin_phone' }, {});
    add('update.home_assistant_core_update', 'on', { friendly_name: 'Home Assistant Core Update', installed_version: '2026.10.4', latest_version: DEMO_VERSION }, { ec: 0 });
    add('sensor.hallway_motion_link_quality', '148', { friendly_name: 'Hallway Motion Link quality', unit_of_measurement: 'lqi', state_class: 'measurement' }, { ai: 'hallway', ec: 1 });

    function sunAttributes(t) {
      const today = startOfDay(t);
      const rise = atHour(today, 7.52);
      const set = atHour(today, 16.73);
      return {
        friendly_name: 'Sun',
        next_rising: new Date(t < rise ? rise : rise + DAY).toISOString(),
        next_setting: new Date(t < set ? set : set + DAY).toISOString(),
      };
    }

    // -- State changes ---------------------------------------------------------------------

    function compressed(st) {
      return { s: st.state, a: st.attributes, lc: st.last_changed / 1000, lu: st.last_updated / 1000, c: '' };
    }

    function publish(message) {
      subscribers.forEach((callback) => callback(message));
    }

    function setState(id, state, attributes = {}) {
      const current = states.get(id);
      if (!current) return;
      const now = Date.now();
      const next = { ...current, attributes: { ...current.attributes } };
      const plus = {};
      if (state !== undefined && state !== current.state) {
        next.state = state;
        next.last_changed = next.last_updated = now;
        plus.s = state;
        plus.lc = now / 1000;
        if (!changeLog.has(id)) changeLog.set(id, []);
        changeLog.get(id).push([now, state]);
      }
      const changed = {};
      for (const [key, value] of Object.entries(attributes)) {
        if (JSON.stringify(current.attributes[key]) !== JSON.stringify(value)) changed[key] = value;
      }
      if (Object.keys(changed).length) {
        Object.assign(next.attributes, changed);
        plus.a = changed;
        if (plus.lc === undefined) {
          next.last_updated = now;
          plus.lu = now / 1000;
        }
      }
      if (!Object.keys(plus).length) return;
      states.set(id, next);
      publish({ c: { [id]: { '+': plus } } });
    }

    function lightOn(id, extra = {}) {
      const st = states.get(id);
      const saved = lightMemory.get(id) || {};
      const brightness = extra.brightness ?? st.attributes.brightness ?? saved.brightness ?? 255;
      const rgb = st.attributes.rgb_color || saved.rgb_color || [255, 255, 255];
      lightMemory.set(id, { brightness, rgb_color: rgb });
      setState(id, 'on', { brightness, rgb_color: rgb, color_mode: 'rgb' });
    }

    function lightOff(id) {
      setState(id, 'off', { brightness: null, rgb_color: null, color_mode: null });
    }

    function switchTo(id, on) {
      const domain = HB.domainOf(id);
      overridden.add(id);
      if (domain === 'light') {
        if (on) lightOn(id);
        else lightOff(id);
      } else if (domain === 'fan') {
        const pct = states.get(id).attributes.percentage || 50;
        setState(id, on ? 'on' : 'off', { percentage: on ? Math.max(pct, 10) : 0 });
      } else {
        setState(id, on ? 'on' : 'off');
      }
    }

    const SCENES = {
      'scene.movie_night': () => {
        ['light.kitchen_counter', 'light.kitchen_island', 'light.hallway', 'light.living_room_ceiling'].forEach((id) => switchTo(id, false));
        ['light.living_room_floor_lamp', 'light.tv_ambilight'].forEach((id) => switchTo(id, true));
        setState('cover.living_room_blinds', 'closed', { current_position: 0 });
      },
      'scene.good_morning': () => {
        ['light.kitchen_counter', 'light.living_room_ceiling'].forEach((id) => switchTo(id, true));
        setState('cover.living_room_blinds', 'open', { current_position: 100 });
        setState('cover.office_shades', 'open', { current_position: 80 });
      },
      'scene.dinner': () => {
        ['light.kitchen_island', 'light.living_room_floor_lamp'].forEach((id) => switchTo(id, true));
        switchTo('light.office_desk', false);
      },
      'scene.goodnight': () => {
        for (const id of states.keys()) if (id.startsWith('light.')) switchTo(id, false);
        setState('lock.front_door', 'locked');
        setState('cover.living_room_blinds', 'closed', { current_position: 0 });
      },
    };

    function mediaPosition(st, now) {
      const a = st.attributes;
      if (st.state !== 'playing') return a.media_position || 0;
      return (a.media_position || 0) + (now - Date.parse(a.media_position_updated_at)) / 1000;
    }

    function playTrack(id, index) {
      mediaIndex = (index + PLAYLIST.length) % PLAYLIST.length;
      setState(id, 'playing', { ...PLAYLIST[mediaIndex], media_position: 0, media_position_updated_at: new Date().toISOString() });
    }

    function callService({ domain, service, service_data: data = {}, target = {} }) {
      const ids = [].concat(target.entity_id || data.entity_id || []);
      if (domain === 'weather' && service === 'get_forecasts') {
        const response = {};
        for (const id of ids) response[id] = { forecast: forecast() };
        return { context: { id: 'demo' }, response };
      }
      for (const id of ids) applyService(id, domain, service, data);
      return { context: { id: 'demo' } };
    }

    function applyService(id, domain, service, data) {
      const st = states.get(id);
      if (!st) throw new Error(`Unknown entity ${id}`);
      if (service === 'turn_on' && domain === 'light' && data.brightness_pct != null) {
        overridden.add(id);
        lightOn(id, { brightness: Math.round((HB.clamp(data.brightness_pct, 1, 100) / 100) * 255) });
      } else if (service === 'set_percentage') {
        overridden.add(id);
        setState(id, data.percentage > 0 ? 'on' : 'off', { percentage: data.percentage });
      } else if (service === 'turn_on' || service === 'turn_off' || service === 'toggle') {
        if (domain === 'scene') {
          SCENES[id]?.();
          setState(id, new Date().toISOString());
          return;
        }
        const on = service === 'toggle' ? st.state !== 'on' : service === 'turn_on';
        switchTo(id, on);
      } else if (service === 'set_temperature') {
        const target = Number(data.temperature);
        const current = st.attributes.current_temperature;
        setState(id, undefined, { temperature: target, hvac_action: st.state !== 'off' && current < target - 0.1 ? 'heating' : 'idle' });
      } else if (service === 'set_hvac_mode') {
        setState(id, data.hvac_mode, { hvac_action: data.hvac_mode === 'off' ? 'off' : 'idle' });
      } else if (service === 'open_cover' || service === 'close_cover') {
        const open = service === 'open_cover';
        setState(id, open ? 'open' : 'closed', { current_position: open ? 100 : 0 });
      } else if (service === 'set_cover_position') {
        const position = HB.clamp(Number(data.position), 0, 100);
        setState(id, position > 0 ? 'open' : 'closed', { current_position: position });
      } else if (service === 'stop_cover') {
        /* covers in the demo move instantly */
      } else if (service === 'lock' || service === 'unlock') {
        setState(id, service === 'lock' ? 'locked' : 'unlocked');
      } else if (service === 'media_play_pause') {
        const now = Date.now();
        const playing = st.state === 'playing';
        setState(id, playing ? 'paused' : 'playing', { media_position: Math.round(mediaPosition(st, now)), media_position_updated_at: new Date(now).toISOString() });
      } else if (service === 'media_next_track' || service === 'media_previous_track') {
        playTrack(id, mediaIndex + (service === 'media_next_track' ? 1 : -1));
      } else if (service === 'volume_set') {
        setState(id, undefined, { volume_level: HB.clamp(Number(data.volume_level), 0, 1) });
      } else if (service === 'start' || service === 'return_to_base') {
        setState(id, service === 'start' ? 'cleaning' : 'returning');
      } else {
        throw new Error(`The demo does not simulate ${domain}.${service}`);
      }
    }

    function forecast() {
      const today = startOfDay(Date.now());
      return FORECAST.map(([condition, high, low, rain], i) => ({
        datetime: new Date(today + i * DAY).toISOString(), condition, temperature: high, templow: low,
        precipitation_probability: rain, wind_speed: 10 + i * 2,
      }));
    }

    // -- Live ticking ----------------------------------------------------------------------

    function tick() {
      const now = Date.now();
      for (const [id, { spec, fn }] of numeric) setState(id, fn(now).toFixed(spec.digits));
      for (const [id, , , windows] of SCHEDULED) {
        if (overridden.has(id)) continue;
        const target = scheduledState(windows, now);
        if (target === states.get(id).state) continue;
        if (id.startsWith('light.')) {
          if (target === 'on') lightOn(id);
          else lightOff(id);
        } else {
          setState(id, target);
        }
      }
      setState(MOTION_ID, motionState(now));
      setState('climate.living_room', undefined, climateUpdate('climate.living_room', livingTemp(now)));
      setState('climate.bedroom', undefined, climateUpdate('climate.bedroom', bedroomTemp(now)));
      setState('weather.home', undefined, { temperature: Number(outdoorTemp(now).toFixed(1)) });
      setState('sun.sun', daylight(now) > 0 ? 'above_horizon' : 'below_horizon', sunAttributes(now));
      setState('sensor.washing_machine_status', washerStatus(now));
      const speaker = states.get('media_player.living_room_speaker');
      if (speaker.state === 'playing' && mediaPosition(speaker, now) >= speaker.attributes.media_duration) {
        playTrack(speaker.entity_id, mediaIndex + 1);
      }
    }

    function climateUpdate(id, current) {
      const st = states.get(id);
      const target = st.attributes.temperature;
      const action = st.state === 'off' ? 'off' : current < target - 0.1 ? 'heating' : 'idle';
      return { current_temperature: Number(current.toFixed(1)), hvac_action: action };
    }

    function washerStatus(t) {
      if (!inWindow(t, [WASH])) return 'Idle';
      const h = hourOf(t);
      return h < 9.8 ? 'Heating water' : h > 10.8 ? 'Spinning' : 'Washing';
    }

    let ticker = null;

    function subscribeEntities(callback) {
      subscribers.add(callback);
      const snapshot = {};
      for (const [id, st] of states) snapshot[id] = compressed(st);
      setTimeout(() => callback({ a: snapshot }), 0);
      if (!ticker) ticker = setInterval(tick, TICK_MS);
      return async () => {
        subscribers.delete(callback);
      };
    }

    // -- History and statistics ------------------------------------------------------------

    function historyStep(span) {
      if (span <= DAY) return 5 * MINUTE;
      if (span <= 3 * DAY) return 15 * MINUTE;
      return 30 * MINUTE;
    }

    function attributeRow(id, t) {
      if (id.startsWith('climate.')) {
        const st = states.get(id);
        const current = id === 'climate.bedroom' ? bedroomTemp(t) : livingTemp(t);
        return { current_temperature: Number(current.toFixed(1)), temperature: st.attributes.temperature };
      }
      if (id === 'weather.home') return { temperature: Number(outdoorTemp(t).toFixed(1)) };
      return null;
    }

    function stateTransitions(id, start, end) {
      const generator = schedules.get(id);
      const st = states.get(id);
      const base = generator ? generator(start, Math.min(end, BOOT)) : [[start, st.state]];
      const logged = (changeLog.get(id) || []).filter(([t]) => t > start && t <= end);
      return collapse([...base, ...logged]);
    }

    function history({ start_time: startTime, end_time: endTime, entity_ids: ids, no_attributes: noAttributes }) {
      const start = Date.parse(startTime);
      const end = endTime ? Date.parse(endTime) : Date.now();
      const out = {};
      for (const id of ids) {
        const entry = numeric.get(id);
        if (entry) {
          const rows = [];
          const step = historyStep(end - start);
          for (let t = start; t < end; t += step) rows.push({ s: entry.fn(t).toFixed(entry.spec.digits), lu: t / 1000 });
          rows.push({ s: states.get(id).state, lu: end / 1000 });
          out[id] = rows;
        } else if (!noAttributes && attributeRow(id, start)) {
          const rows = [];
          const step = historyStep(end - start);
          for (let t = start; t <= end; t += step) rows.push({ s: states.get(id).state, a: attributeRow(id, t), lu: t / 1000 });
          out[id] = rows;
        } else if (states.has(id)) {
          out[id] = stateTransitions(id, start, end).map(([t, s]) => ({ s, lu: t / 1000 }));
        }
      }
      return out;
    }

    function periodStart(t, period) {
      const d = new Date(t);
      if (period === 'day') d.setHours(0, 0, 0, 0);
      else d.setMinutes(0, 0, 0);
      return d.getTime();
    }

    function nextPeriod(t, period) {
      return period === 'day' ? startOfDay(t + 36 * HOUR) : t + HOUR;
    }

    function statistics({ start_time: startTime, end_time: endTime, statistic_ids: ids, period }) {
      const start = Date.parse(startTime);
      const end = endTime ? Date.parse(endTime) : Date.now();
      const out = {};
      for (const id of ids) {
        const entry = numeric.get(id);
        if (!entry || !entry.spec.sc) continue;
        const rows = [];
        for (let from = periodStart(start, period); from < end; from = nextPeriod(from, period)) {
          const to = Math.min(nextPeriod(from, period), end);
          if (entry.spec.rate) {
            rows.push({ start: from, end: to, change: integrate(entry.spec.rate, from, to) });
            continue;
          }
          let sum = 0;
          let n = 0;
          let min = Infinity;
          let max = -Infinity;
          for (let t = from; t < to; t += 10 * MINUTE) {
            const v = entry.fn(t);
            sum += v;
            n += 1;
            min = Math.min(min, v);
            max = Math.max(max, v);
          }
          if (n) rows.push({ start: from, end: to, mean: sum / n, min, max });
        }
        out[id] = rows;
      }
      return out;
    }

    function handle(message) {
      switch (message.type) {
        case 'get_config':
          return {
            location_name: 'Demo home', version: DEMO_VERSION, time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            unit_system: { temperature: '°C', length: 'km', mass: 'kg', pressure: 'Pa', volume: 'L', wind_speed: 'm/s' },
          };
        case 'config/area_registry/list':
          return AREAS.map(([area_id, name]) => ({ area_id, name }));
        case 'config/entity_registry/list_for_display':
          return { entity_categories: { 0: 'config', 1: 'diagnostic' }, entities: registry };
        case 'config/device_registry/list':
          return [];
        case 'history/history_during_period':
          return history(message);
        case 'recorder/statistics_during_period':
          return statistics(message);
        case 'call_service':
          return callService(message);
        case 'ping':
          return null;
        default:
          throw new Error(`The demo does not support ${message.type}`);
      }
    }

    return { handle, subscribeEntities };
  }

  /** Creates a backend that serves the simulated home instead of a real Home Assistant. */
  HB.createDemoBackend = () => {
    const simulation = createSimulation();
    const listeners = new Map();
    const latency = () => 60 + Math.random() * 160;
    return {
      kind: 'demo',
      hassUrl: '',
      start: async () => (listeners.get('status') || []).forEach((callback) => callback('demo')),
      send: (message) =>
        new Promise((resolve, reject) => {
          setTimeout(() => {
            try {
              resolve(simulation.handle(message));
            } catch (err) {
              reject(err);
            }
          }, latency());
        }),
      subscribe: async (message, callback) => {
        if (message.type !== 'subscribe_entities') throw new Error(`The demo does not support ${message.type}`);
        return simulation.subscribeEntities(callback);
      },
      on: (event, callback) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(callback);
      },
      describe: () => ({ mode: 'Demo data', url: 'Simulated home', version: DEMO_VERSION }),
      signOut: null,
    };
  };
})(window.HB = window.HB || {});
