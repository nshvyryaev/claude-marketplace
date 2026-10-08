// Окружение прогона: параметры URL, часы, часовой пояс, сеть, размер окна,
// сервер API, подмена ответов, хранилище до загрузки.
//
// Всё здесь — по выбору прогона: поле не задано — плагин ведёт себя как
// раньше. Те же нормализации служат операциям моста посреди прогона
// (`network`, `viewport`, `clock`, `reload`, `intercept` из act()).
import { serverSpec } from './server.mjs';

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

// Параметр к готовой строке query: адрес сервера прогона (`?api=…`) поверх
// параметров прогона; одноимённый параметр прогона заменяется.
export function withParam(query, key, value) {
  const params = new URLSearchParams(query.replace(/^\?/, ''));
  params.delete(key);
  const rest = params.toString().replace(/=(?=&|$)/g, '');
  const own = `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  return `?${rest ? `${rest}&` : ''}${own}`;
}

// `intercept`: подмена ответов (B-2) — CDP Fetch.requestPaused. Правило:
// { url: '*/v1/runs*' (шаблон Fetch: * и ?), delay?: мс, fail?: true|'refused'|
// 'timeout'|'reset'|'unreachable', status?: код, body?: строка }. delay — запрос
// уходит позже; fail — адрес недостижим; status — ответ без сервера.
export const FAIL_REASONS = { refused: 'ConnectionRefused', timeout: 'TimedOut', reset: 'ConnectionReset', unreachable: 'AddressUnreachable' };

const globRe = (glob) => new RegExp(`^${glob.split('').map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('')}$`);

export function interceptRules(rules) {
  if (!Array.isArray(rules)) throw fault(`intercept: массив правил, а не ${JSON.stringify(rules)}`);
  return rules.map((rule) => {
    const where = `intercept ${JSON.stringify(rule)}`;
    if (!rule || typeof rule !== 'object' || typeof rule.url !== 'string' || rule.url === '') throw fault(`${where}: нужен url-шаблон`);
    if (rule.delay !== undefined && !(Number.isFinite(rule.delay) && rule.delay >= 0)) throw fault(`${where}: delay — мс ≥ 0`);
    if (rule.fail !== undefined && rule.fail !== true && !Object.hasOwn(FAIL_REASONS, rule.fail)) throw fault(`${where}: fail — true или ${Object.keys(FAIL_REASONS).join('|')}`);
    if (rule.status !== undefined && !(Number.isInteger(rule.status) && rule.status >= 200 && rule.status <= 599)) throw fault(`${where}: status — код 200–599`);
    if (rule.fail !== undefined && rule.status !== undefined) throw fault(`${where}: fail и status вместе не бывают`);
    if (rule.delay === undefined && rule.fail === undefined && rule.status === undefined) throw fault(`${where}: нужен delay, fail или status`);
    if (rule.body !== undefined && typeof rule.body !== 'string') throw fault(`${where}: body — строка`);
    return { ...rule, fail: rule.fail === true ? 'refused' : rule.fail, re: globRe(rule.url) };
  });
}

// `storage` (B-3): хранилище страницы до загрузки игры — объект или путь к
// JSON-файлу от корня проекта: { localStorage: { ключ: значение }, caches:
// { "<кэш>": [ { url, body?, file?, status?, headers? } ] } }. Значение
// localStorage не строка — JSON-строкой; {api} в url — адрес сервера прогона.
export function storageSpec(spec) {
  if (typeof spec === 'string' && spec !== '') return spec;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw fault(`storage: объект или путь к JSON, а не ${JSON.stringify(spec)}`);
  const extra = Object.keys(spec).filter((k) => k !== 'localStorage' && k !== 'caches');
  if (extra.length) throw fault(`storage: неизвестные поля ${extra.join(', ')}`);
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (spec.localStorage !== undefined && !isObj(spec.localStorage)) throw fault('storage.localStorage: объект');
  if (spec.caches !== undefined) {
    if (!isObj(spec.caches)) throw fault('storage.caches: { "<кэш>": [записи] }');
    for (const [name, entries] of Object.entries(spec.caches)) {
      if (!Array.isArray(entries)) throw fault(`storage.caches.${name}: массив записей`);
      for (const e of entries) {
        if (!e || typeof e.url !== 'string' || e.url === '') throw fault(`storage.caches.${name}: у записи нужен url`);
        const where = `storage.caches.${name} ${e.url}`;
        if (e.body !== undefined && e.file !== undefined) throw fault(`${where}: body или file, не оба`);
        if (e.body !== undefined && typeof e.body !== 'string') throw fault(`${where}: body — строка`);
        if (e.file !== undefined && (typeof e.file !== 'string' || e.file === '')) throw fault(`${where}: file — путь от корня проекта`);
        if (e.status !== undefined && !(Number.isInteger(e.status) && e.status >= 200 && e.status <= 599)) throw fault(`${where}: status 200–599`);
        if (e.headers !== undefined && !(isObj(e.headers) && Object.values(e.headers).every((v) => typeof v === 'string'))) throw fault(`${where}: headers — объект строк`);
      }
    }
  }
  return spec;
}

// Поля прогона, которые читает сам плагин (а не мост). Проверяются при
// загрузке прогонов, чтобы опечатка всплыла до запуска Chrome.
export const ENV_FIELDS = ['query', 'clock', 'timezone', 'network', 'viewport', 'server', 'intercept', 'storage'];

export function validateEnv(spec) {
  if (spec.query !== undefined) queryString(spec.query);
  if (spec.clock !== undefined) clockMs(spec.clock);
  if (spec.timezone !== undefined) timezoneId(spec.timezone);
  if (spec.network !== undefined) { networkParams(spec.network); networkAt(spec.network); }
  if (spec.viewport !== undefined) viewportParams(spec.viewport ?? {});
  if (spec.server !== undefined && spec.server !== false && spec.server !== null) serverSpec(spec.server);
  if (spec.intercept !== undefined) interceptRules(spec.intercept);
  if (spec.storage !== undefined) storageSpec(spec.storage);
}

export function pickEnv(spec) {
  const env = {};
  for (const key of ENV_FIELDS) if (spec?.[key] !== undefined && spec[key] !== null) env[key] = spec[key];
  return env;
}
