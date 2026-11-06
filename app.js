const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const naira = n => '₦' + Number(n).toLocaleString('en-NG');
let settings = {}, packages = [];

async function api(url, body) {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong. Try again.');
  return d;
}
const wa = text => {
  const n = (settings.whatsapp || '').replace(/\D/g, '');
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
};
const show = (el, text, ok) => { el.innerHTML = text ? `<div class="msg ${ok ? 'ok' : 'err'}">${esc(text)}</div>` : ''; };

function tipHTML(p) {
  const when = new Date(p.match_date + 'T00:00:00').toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
  return `<div class="tip"><div><b>${esc(p.home)} vs ${esc(p.away)}</b><small>${esc(p.league)}${p.league ? ' · ' : ''}${when}</small></div>
    <div class="pick">${esc(p.tip)}${p.odds ? ' @ ' + Number(p.odds).toFixed(2) : ''}</div>
    <span class="res ${esc(p.result)}">${esc(p.result)}</span></div>`;
}
const tipsList = (el, list, empty) => { el.innerHTML = list.length ? list.map(tipHTML).join('') : `<div class="empty">${empty}</div>`; };

async function init() {
  const d = await api('/api/public');
  settings = d.settings; packages = d.packages;
  if (settings.promo) { $('#promo').textContent = settings.promo; $('#promo').classList.remove('hidden'); }
  const hello = 'Hello, I want to join VIP MDC.';
  $('#wa-hero').href = $('#wa-cta').href = wa(hello);
  const t = d.stats.won + d.stats.lost;
  $('#record').innerHTML = t ? `<div><b>${d.stats.won}</b>won (30 days)</div><div><b>${d.stats.lost}</b>lost (30 days)</div><div><b>${Math.round(d.stats.won / t * 100)}%</b>hit rate</div>` : '';
  tipsList($('#free-tips'), d.free, 'No free tips right now. Check back later.');
  const mid = packages.length > 1 ? 1 : -1;
  $('#packages-list').innerHTML = packages.map((p, i) => `<div class="card ${i === mid ? 'highlight' : ''}">
    <h3>${esc(p.name)}</h3><div class="price">${naira(p.price)}</div><p>${esc(p.description)}</p>
    <p style="margin-top:6px;font-size:13px">${p.duration_days} days access</p>
    <a class="btn" href="#subscribe" data-pkg="${p.id}">Choose ${esc(p.name)}</a></div>`).join('');
  $('#s-pkg').innerHTML = packages.map(p => `<option value="${p.id}">${esc(p.name)} — ${naira(p.price)}</option>`).join('');
  if (settings.account_number) {
    $('#pay').classList.remove('hidden');
    $('#pay').innerHTML = `Pay to: <b>${esc(settings.account_number)}</b> · ${esc(settings.bank_name)}<br>Account name: <b>${esc(settings.account_name)}</b>`;
  }
  const saved = sessionStorage.getItem('vip');
  if (saved) { const s = JSON.parse(saved); $('#m-phone').value = s.phone; $('#m-code').value = s.code; login(s.phone, s.code, true); }
}

document.addEventListener('click', e => {
  const a = e.target.closest('[data-pkg]');
  if (a) $('#s-pkg').value = a.dataset.pkg;
});

$('#sub-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button'), msg = $('#sub-msg');
  btn.disabled = true; show(msg, '');
  try {
    const f = Object.fromEntries(new FormData(e.target));
    const r = await api('/api/subscribe', f);
    const p = packages.find(x => x.id == f.package_id);
    show(msg, r.message, true);
    if (settings.whatsapp) msg.insertAdjacentHTML('beforeend',
      `<a class="btn" style="margin-top:14px;width:100%;text-align:center" target="_blank" rel="noopener" href="${esc(wa(`Hello, I just requested ${p.name} (${naira(p.price)}). Name: ${f.name}, phone: ${f.phone}. Sending payment proof now.`))}">Send payment proof on WhatsApp</a>`);
    e.target.reset();
  } catch (err) { show(msg, err.message); }
  btn.disabled = false;
});

async function login(phone, code, silent) {
  const msg = $('#login-msg');
  try {
    const d = await api('/api/member/login', { phone, code });
    sessionStorage.setItem('vip', JSON.stringify({ phone, code }));
    $('#login-form').classList.add('hidden'); $('#vip-room').classList.remove('hidden');
    $('#member-info').textContent = `${d.member.name} · ${d.member.package} · valid until ${d.member.expires_at}`;
    tipsList($('#vip-tips'), d.predictions, 'No VIP selections posted yet. Check back soon.');
    show(msg, '');
  } catch (err) { sessionStorage.removeItem('vip'); if (!silent) show(msg, err.message); }
}
$('#login-form').addEventListener('submit', e => { e.preventDefault(); login($('#m-phone').value, $('#m-code').value); });
$('#logout').addEventListener('click', () => {
  sessionStorage.removeItem('vip'); $('#vip-room').classList.add('hidden'); $('#login-form').classList.remove('hidden'); $('#m-code').value = '';
});

init().catch(() => { $('#free-tips').innerHTML = '<div class="empty">Could not load data. Refresh the page.</div>'; });
