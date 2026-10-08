// Игрушечный сервер API для проверок `server` прогона: порт из PORT, база из
// DB_FILE (по умолчанию в памяти) со своей «миграцией», CORS для страницы.
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(process.env.DB_FILE || ':memory:');
db.exec('PRAGMA journal_mode = WAL');
db.exec('CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY, name TEXT NOT NULL, meta TEXT)');
if (process.env.TOY_FAIL_BOOT === '1') { console.error('toy: отказ старта'); process.exit(3); }

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  const send = (status, body) => res.writeHead(status, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(body));
  if (req.url === '/healthz') return send(200, { ok: true, mark: process.env.TOY_MARK ?? null });
  if (req.url.startsWith('/v1/players')) return send(200, db.prepare('SELECT id, name, meta FROM players ORDER BY id').all());
  return send(404, { error: 'not found' });
});
server.listen(Number(process.env.PORT), '127.0.0.1', () => console.log(`toy: слушает ${process.env.PORT}`));
process.on('SIGTERM', () => process.exit(0));
