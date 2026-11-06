const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'vipmdc.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  tier INTEGER NOT NULL,
  description TEXT DEFAULT '',
  duration_days INTEGER NOT NULL DEFAULT 30,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_date TEXT NOT NULL,
  league TEXT DEFAULT '',
  home TEXT NOT NULL,
  away TEXT NOT NULL,
  tip TEXT NOT NULL,
  odds REAL,
  tier INTEGER NOT NULL DEFAULT 1,
  result TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  package_id INTEGER NOT NULL REFERENCES packages(id),
  reference TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  code TEXT,
  expires_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS idx_pred_date ON predictions(match_date);
CREATE INDEX IF NOT EXISTS idx_sub_phone ON subscribers(phone);
`);

if (!db.prepare('SELECT COUNT(*) c FROM packages').get().c) {
  const ins = db.prepare('INSERT INTO packages (name,price,tier,description) VALUES (?,?,?,?)');
  ins.run('Basic VIP', 700, 1, 'Access to selected daily football predictions.');
  ins.run('Premium VIP', 1000, 2, 'More daily selections and premium prediction access.');
  ins.run('Pro VIP', 1400, 3, 'Our extended package for members who want more selections.');
}
const defaults = { whatsapp: '', bank_name: '', account_name: '', account_number: '', promo: '' };
const setIns = db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)');
for (const [k, v] of Object.entries(defaults)) setIns.run(k, v);

module.exports = db;
