// Окружение прогона: параметры URL, часы, часовой пояс, сеть, размер окна.
//
// Всё здесь — по выбору прогона: поле не задано — плагин ведёт себя как
// раньше. Те же нормализации служат операциям моста посреди прогона
// (`network`, `viewport`, `clock`, `reload` из act()).

// Ошибка в поле прогона или операции моста — ошибка проекта, а не игры.
function fault(message) {
  const error = new Error(message);
  error.adapterFault = true;
  return error;
}

// `query`: строка («prod&api=http://…») или объект ({ prod: true, api: '…' }).
// true — параметр без значения (`?prod`), false/null — параметра нет.
export function queryString(query) {
  if (query == null || query === '') return '';
  if (typeof query === 'string') return `?${query.replace(/^\?/, '')}`;
  if (typeof query !== 'object' || Array.isArray(query)) throw fault(`query: строка или объект, а не ${JSON.stringify(query)}`);
  const parts = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === false || value == null) continue;
    parts.push(value === true ? encodeURIComponent(key) : `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

// `clock`: ISO-строка или мс эпохи — Date.now() страницы в момент старта
// уровня; дальше часы идут с виртуальным временем шима.
export function clockMs(clock) {
  const ms = typeof clock === 'number' ? clock : typeof clock === 'string' ? Date.parse(clock) : NaN;
  if (!Number.isFinite(ms)) throw fault(`clock: ISO-дата или мс эпохи, а не ${JSON.stringify(clock)}`);
  return Math.floor(ms);
}

// `network`: 'offline' | 'online' | { offline, latency, download, upload }
// (latency — мс, download/upload — байт/с) → параметры
// Network.emulateNetworkConditions.
export function networkParams(spec) {
  const value = spec === 'offline' ? { offline: true } : spec === 'online' ? {} : spec;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fault(`network: 'offline', 'online' или объект, а не ${JSON.stringify(spec)}`);
  if (value.offline !== undefined && typeof value.offline !== 'boolean') throw fault(`network.offline: boolean, а не ${JSON.stringify(value.offline)}`);
  for (const key of ['latency', 'download', 'upload']) {
    if (value[key] !== undefined && !(Number.isFinite(value[key]) && value[key] >= 0)) throw fault(`network.${key}: число ≥ 0, а не ${JSON.stringify(value[key])}`);
  }
  return {
    offline: !!value.offline,
    latency: value.latency ?? 0,
    downloadThroughput: value.download ?? -1,
    uploadThroughput: value.upload ?? -1,
  };
}

// Когда включаются условия сети прогона: 'boot' — как только движок загрузился
// (до preload и старта уровня), 'ready' — когда уровень готов к вводу.
export function networkAt(spec) {
  const at = (spec && typeof spec === 'object' && spec.at) || 'boot';
  if (at !== 'boot' && at !== 'ready') throw fault(`network.at: 'boot' или 'ready', а не ${JSON.stringify(at)}`);
  return at;
}

// Размер окна → Emulation.setDeviceMetricsOverride. mobile: true — экран
// телефона: ориентация по сторонам (портрет, если высота больше ширины).
export function viewportParams({ width, height, mobile = false }) {
  if (!(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0)) {
    throw fault(`viewport: целые width и height > 0, а не ${JSON.stringify({ width, height })}`);
  }
  if (typeof mobile !== 'boolean') throw fault(`viewport.mobile: boolean, а не ${JSON.stringify(mobile)}`);
  const params = { width, height, deviceScaleFactor: 1, mobile };
  if (mobile) {
    params.screenOrientation = height > width ? { type: 'portraitPrimary', angle: 0 } : { type: 'landscapePrimary', angle: 90 };
  }
  return params;
}

export function timezoneId(timezone) {
  if (typeof timezone !== 'string' || timezone === '') throw fault(`timezone: имя пояса IANA, а не ${JSON.stringify(timezone)}`);
  return timezone;
}

// Поля прогона, которые читает сам плагин (а не мост). Проверяются при
// загрузке прогонов, чтобы опечатка всплыла до запуска Chrome.
export const ENV_FIELDS = ['query', 'clock', 'timezone', 'network', 'viewport'];

export function validateEnv(spec) {
  if (spec.query !== undefined) queryString(spec.query);
  if (spec.clock !== undefined) clockMs(spec.clock);
  if (spec.timezone !== undefined) timezoneId(spec.timezone);
  if (spec.network !== undefined) { networkParams(spec.network); networkAt(spec.network); }
  if (spec.viewport !== undefined) viewportParams(spec.viewport ?? {});
}

export function pickEnv(spec) {
  const env = {};
  for (const key of ENV_FIELDS) if (spec?.[key] !== undefined && spec[key] !== null) env[key] = spec[key];
  return env;
}
