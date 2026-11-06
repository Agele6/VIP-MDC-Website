const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// Minimal .env loader
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*(\w+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}

const db = require('./db/database');
const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
if (!process.env.ADMIN_PASSWORD) console.warn('\n⚠  Using default admin password "admin123". Set ADMIN_PASSWORD in .env before going live.\n');

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
const sessions = new Map();
const hits = new Map();
const limit = (max, ms) => (req, res, next) => {
  const k = req.ip + req.path, now = Date.now();
  const a = (hits.get(k) || []).filter(t => now - t < ms);
  if (a.length >= max) return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
  a.push(now); hits.set(k, a); next();
};
const auth = (req, res, next) => {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  const exp = sessions.get(t);
  if (!exp || exp < Date.now()) return res.status(401).json({ error: 'Please log in again.' });
  next();
};
const safeEq = (a, b) => crypto.timingSafeEqual(
  crypto.createHash('sha256').update(String(a)).digest(),
  crypto.createHash('sha256').update(String(b)).digest());
const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const phoneNorm = p => {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('234')) d = '0' + d.slice(3);
  return d;
};
const genCode = () => crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
const settingsObj = () => Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(r => [r.key, r.value]));
const today = () => new Date().toISOString().slice(0, 10);

// ---------- public API ----------
app.get('/api/public', (req, res) => {
  const s = settingsObj();
  const packages = db.prepare('SELECT id,name,price,tier,description,duration_days FROM packages WHERE active=1 ORDER BY tier').all();
  const free = db.prepare("SELECT id,match_date,league,home,away,tip,odds,result FROM predictions WHERE tier=0 ORDER BY match_date DESC, id DESC LIMIT 6").all();
  const stats = db.prepare(`SELECT
      SUM(result='won') won, SUM(result='lost') lost
      FROM predictions WHERE match_date >= date('now','-30 day')`).get();
  res.json({
    settings: { whatsapp: s.whatsapp, bank_name: s.bank_name, account_name: s.account_name, account_number: s.account_number, promo: s.promo },
    packages, free, stats: { won: stats.won || 0, lost: stats.lost || 0 }
  });
});

app.post('/api/subscribe', limit(8, 3600e3), (req, res) => {
  const name = str(req.body.name, 80), phone = phoneNorm(req.body.phone);
  const reference = str(req.body.reference, 100);
  const pkg = db.prepare('SELECT * FROM packages WHERE id=? AND active=1').get(Number(req.body.package_id));
  if (name.length < 2) return res.status(400).json({ error: 'Enter your name.' });
  if (phone.length < 10 || phone.length > 15) return res.status(400).json({ error: 'Enter a valid phone number.' });
  if (!pkg) return res.status(400).json({ error: 'Choose a package.' });
  const dup = db.prepare("SELECT id FROM subscribers WHERE phone=? AND status='pending'").get(phone);
  if (dup) return res.status(409).json({ error: 'You already have a pending request. We will confirm it shortly.' });
  db.prepare('INSERT INTO subscribers (name,phone,package_id,reference) VALUES (?,?,?,?)').run(name, phone, pkg.id, reference);
  res.json({ ok: true, message: 'Request received. Send your payment proof on WhatsApp and we will activate your access.' });
});

app.post('/api/member/login', limit(15, 900e3), (req, res) => {
  const phone = phoneNorm(req.body.phone), code = str(req.body.code, 20).toUpperCase();
  const sub = db.prepare(`SELECT s.name, s.expires_at, p.name package, p.tier FROM subscribers s
    JOIN packages p ON p.id=s.package_id
    WHERE s.phone=? AND s.code=? AND s.status='active' AND s.expires_at >= ?`).get(phone, code, today());
  if (!phone || !code || !sub) return res.status(401).json({ error: 'Phone number or access code is not valid, or your plan has expired.' });
  const predictions = db.prepare(`SELECT id,match_date,league,home,away,tip,odds,tier,result FROM predictions
    WHERE tier<=? ORDER BY match_date DESC, id DESC LIMIT 60`).all(sub.tier);
  res.json({ member: sub, predictions });
});

// ---------- admin API ----------
app.post('/api/admin/login', limit(8, 900e3), (req, res) => {
  if (!safeEq(req.body.password || '', ADMIN_PASSWORD)) return res.status(401).json({ error: 'Wrong password.' });
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + 12 * 3600e3);
  res.json({ token });
});
app.post('/api/admin/logout', auth, (req, res) => {
  sessions.delete((req.headers.authorization || '').replace('Bearer ', '')); res.json({ ok: true });
});

app.get('/api/admin/overview', auth, (req, res) => {
  res.json(db.prepare(`SELECT
    (SELECT COUNT(*) FROM subscribers WHERE status='pending') pending,
    (SELECT COUNT(*) FROM subscribers WHERE status='active' AND expires_at>=date('now')) active,
    (SELECT COUNT(*) FROM predictions) predictions`).get());
});

app.get('/api/admin/subscribers', auth, (req, res) => {
  res.json(db.prepare(`SELECT s.*, p.name package, p.price FROM subscribers s
    JOIN packages p ON p.id=s.package_id ORDER BY (s.status='pending') DESC, s.id DESC`).all());
});
app.post('/api/admin/subscribers/:id/approve', auth, (req, res) => {
  const sub = db.prepare('SELECT s.*, p.duration_days d FROM subscribers s JOIN packages p ON p.id=s.package_id WHERE s.id=?').get(req.params.id);
  if (!sub) return res.status(404).json({ error: 'Not found' });
  const days = Math.min(Math.max(parseInt(req.body.days) || sub.d, 1), 366);
  const base = sub.status === 'active' && sub.expires_at >= today() ? new Date(sub.expires_at) : new Date();
  base.setDate(base.getDate() + days);
  const code = sub.code || genCode();
  db.prepare("UPDATE subscribers SET status='active', code=?, expires_at=? WHERE id=?").run(code, base.toISOString().slice(0, 10), sub.id);
  res.json({ ok: true, code, expires_at: base.toISOString().slice(0, 10) });
});
app.post('/api/admin/subscribers/:id/reject', auth, (req, res) => {
  db.prepare("UPDATE subscribers SET status='rejected' WHERE id=?").run(req.params.id); res.json({ ok: true });
});
app.delete('/api/admin/subscribers/:id', auth, (req, res) => {
  db.prepare('DELETE FROM subscribers WHERE id=?').run(req.params.id); res.json({ ok: true });
});

const predFields = b => {
  const odds = parseFloat(b.odds);
  const result = ['pending', 'won', 'lost', 'void'].includes(b.result) ? b.result : 'pending';
  const tier = Math.min(Math.max(parseInt(b.tier) || 0, 0), 3);
  const m = str(b.match_date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m)) throw new Error('Enter a valid date.');
  if (!str(b.home) || !str(b.away) || !str(b.tip)) throw new Error('Home, away and tip are required.');
  return [m, str(b.league, 80), str(b.home, 80), str(b.away, 80), str(b.tip, 100), isNaN(odds) ? null : odds, tier, result];
};
app.get('/api/admin/predictions', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM predictions ORDER BY match_date DESC, id DESC LIMIT 200').all());
});
app.post('/api/admin/predictions', auth, (req, res) => {
  try {
    db.prepare('INSERT INTO predictions (match_date,league,home,away,tip,odds,tier,result) VALUES (?,?,?,?,?,?,?,?)').run(...predFields(req.body));
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/admin/predictions/:id', auth, (req, res) => {
  try {
    db.prepare('UPDATE predictions SET match_date=?,league=?,home=?,away=?,tip=?,odds=?,tier=?,result=? WHERE id=?').run(...predFields(req.body), req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/admin/predictions/:id', auth, (req, res) => {
  db.prepare('DELETE FROM predictions WHERE id=?').run(req.params.id); res.json({ ok: true });
});

app.get('/api/admin/packages', auth, (req, res) => res.json(db.prepare('SELECT * FROM packages ORDER BY tier').all()));
app.put('/api/admin/packages/:id', auth, (req, res) => {
  const b = req.body;
  db.prepare('UPDATE packages SET name=?,price=?,description=?,duration_days=?,active=? WHERE id=?')
    .run(str(b.name, 60), Math.max(0, parseInt(b.price) || 0), str(b.description, 300), Math.max(1, parseInt(b.duration_days) || 30), b.active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/settings', auth, (req, res) => res.json(settingsObj()));
app.put('/api/admin/settings', auth, (req, res) => {
  const up = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  for (const k of ['whatsapp', 'bank_name', 'account_name', 'account_number', 'promo']) {
    if (k in req.body) up.run(k, k === 'whatsapp' ? str(req.body[k], 20).replace(/\D/g, '') : str(req.body[k], 200));
  }
  res.json({ ok: true });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.listen(PORT, () => console.log(`VIP MDC running → http://localhost:${PORT}  |  Admin → http://localhost:${PORT}/admin`));
