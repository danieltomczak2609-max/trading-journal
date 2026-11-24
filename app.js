/* =====================================================================
   Trading Journal – App
   Live-Sync mit MetaTrader 5 über Supabase (Postgres + Realtime)
   ===================================================================== */
'use strict';

const CFG = Object.assign({ supabaseUrl: '', supabaseKey: '', demo: false }, window.TJ_CONFIG || {});
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem('tj.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('tj.' + k, JSON.stringify(v)); } catch (e) { } },
  del(k) { try { localStorage.removeItem('tj.' + k); } catch (e) { } }
};

const DEFAULTS = {
  setups: ['Breakout', 'Pullback', 'Trendfolge', 'Range', 'Reversal', 'Liquidity Sweep', 'News'],
  tags: ['A+ Setup', 'London', 'New York', 'Asien', 'Gegen Trend', 'Teilgewinn', 'Scaling-in'],
  mistakes: ['FOMO', 'Zu früh raus', 'Zu spät rein', 'SL verschoben', 'Kein SL', 'Überhebelt', 'Revenge Trade', 'Gegen Plan', 'Overtrading'],
  emotions: ['Ruhig', 'Fokussiert', 'Zuversichtlich', 'Ungeduldig', 'Nervös', 'Gierig', 'Ängstlich', 'Frustriert', 'Müde']
};

const VIEWS = [
  { id: 'dashboard', label: 'Übersicht', icon: 'dash' },
  { id: 'trades', label: 'Trades', icon: 'list' },
  { id: 'kalender', label: 'Kalender', icon: 'cal' },
  { id: 'statistik', label: 'Statistik', icon: 'chart' },
  { id: 'konten', label: 'Konten', icon: 'wallet' },
  { id: 'einstellungen', label: 'Einstellungen', icon: 'gear' }
];
const RANGES = [['all', 'Gesamt'], ['7', '7 T'], ['30', '30 T'], ['90', '90 T'], ['ytd', 'YTD'], ['365', '12 M']];

const ICONS = {
  dash: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  cal: '<rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-7"/>',
  gear: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>',
  dl: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  img: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14 9l2 2"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
  wallet: '<rect x="2.5" y="5.5" width="19" height="14" rx="2.5"/><path d="M16 12.5h2.5M2.5 9.5h19"/>'
};
const ic = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24">${ICONS[n] || ''}</svg>`;

/* ---------------------------------------------------------------------
   State
   --------------------------------------------------------------------- */
const S = {
  mode: null, user: null,
  accounts: [], deals: [], states: {}, meta: {}, journal: {}, daily: {}, tokens: [],
  settings: structuredClone(DEFAULTS),
  trades: [], tradeMap: new Map(),
  accountId: LS.get('account', 'all'), range: LS.get('range', 'all'), view: 'dashboard',
  filters: { q: '', symbol: '', side: '', setup: '', tag: '', result: '', nojournal: false, sort: 'new' },
  listLimit: 60, calMonth: null, selDay: null,
  modal: null, rt: 'off', editing: false, pendingRender: false
};
let DS = null; // Datenquelle (Live oder Demo)

/* ---------------------------------------------------------------------
   Formatierung
   --------------------------------------------------------------------- */
const _nf = {};
const nf = (d = 2) => _nf['n' + d] || (_nf['n' + d] = new Intl.NumberFormat('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }));
function cur() {
  const accs = selAccounts();
  return (accs[0] && accs[0].currency) || 'USD';
}
function money(v, sign = false, c) {
  if (v == null || !isFinite(v)) return '–';
  c = c || cur();
  const k = 'c' + c;
  let f = _nf[k];
  if (!f) { try { f = new Intl.NumberFormat('de-DE', { style: 'currency', currency: c }); } catch (e) { f = nf(2); } _nf[k] = f; }
  const s = f.format(v);
  return sign && v > 0 ? '+' + s : s;
}
function compact(v) {
  if (v == null || !isFinite(v)) return '';
  const a = Math.abs(v), s = v > 0 ? '+' : v < 0 ? '−' : '';
  if (a >= 1e6) return s + nf(1).format(a / 1e6) + 'M';
  if (a >= 1e4) return s + nf(0).format(a / 1e3) + 'k';
  if (a >= 1e3) return s + nf(1).format(a / 1e3) + 'k';
  return s + nf(0).format(a);
}
const pct = (v, d = 1) => (v == null || !isFinite(v)) ? '–' : nf(d).format(v * 100) + ' %';
const rFmt = r => (r == null || !isFinite(r)) ? '–' : (r > 0 ? '+' : '') + nf(2).format(r) + 'R';
const num = (v, d = 2) => (v == null || !isFinite(v)) ? '–' : nf(d).format(v);
const cls = v => v > 0 ? 'pos' : v < 0 ? 'neg' : '';
function price(v, sym) {
  if (!v) return '–';
  const d = v >= 1000 ? 2 : v >= 100 ? 3 : v >= 10 ? 4 : 5;
  return nf(d).format(v);
}
function dur(ms) {
  if (ms == null || !isFinite(ms)) return '–';
  const m = Math.round(ms / 60000);
  if (m < 1) return '< 1 Min';
  if (m < 60) return m + ' Min';
  const h = Math.floor(m / 60), mm = m % 60;
  if (h < 24) return h + ' Std' + (mm ? ' ' + mm + ' Min' : '');
  const d = Math.floor(h / 24);
  return d + ' T ' + (h % 24) + ' Std';
}
const pad = n => String(n).padStart(2, '0');
function fDate(t, withTime = true) {
  if (!t) return '–';
  const d = new Date(t);
  const s = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;
  return withTime ? s + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : s;
}
const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
function ago(t) {
  if (!t) return 'nie';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'vor ' + s + ' s';
  if (s < 3600) return 'vor ' + Math.round(s / 60) + ' Min';
  if (s < 86400) return 'vor ' + Math.round(s / 3600) + ' Std';
  return fDate(t);
}

/* ---------------------------------------------------------------------
   Datenmodell: Deals → Trades
   --------------------------------------------------------------------- */
const tkey = (a, p) => a + ':' + p;

function buildTrades() {
  const byPos = new Map();
  for (const d of S.deals) {
    if (d.type > 1 || !d.position_id) continue;
    const k = tkey(d.account_id, d.position_id);
    let arr = byPos.get(k);
    if (!arr) byPos.set(k, arr = []);
    arr.push(d);
  }
  const trades = [];
  for (const [k, ds] of byPos) {
    ds.sort((a, b) => a.t - b.t || a.ticket - b.ticket);
    let vin = 0, pin = 0, vout = 0, pout = 0, profit = 0, comm = 0, swap = 0, fee = 0, dir = null, open = null, close = null, sl = null, tp = null;
    for (const d of ds) {
      if (d.entry === 0) {
        if (dir === null) { dir = d.type === 0 ? 'long' : 'short'; open = d.t; }
        vin += d.volume; pin += d.price * d.volume;
        if (sl == null && d.sl) sl = d.sl;
        if (tp == null && d.tp) tp = d.tp;
      } else { vout += d.volume; pout += d.price * d.volume; close = d.t; }
      profit += d.profit; comm += d.commission; swap += d.swap; fee += d.fee;
    }
    if (dir === null || vin <= 0) continue;
    const closed = vout >= vin - 1e-9;
    if (!closed) continue;
    const meta = S.meta[k] || {};
    const j = S.journal[k] || null;
    const net = profit + comm + swap + fee;
    const risk = (j && j.planned_risk > 0) ? +j.planned_risk : (meta.initial_risk > 0 ? +meta.initial_risk : null);
    trades.push({
      key: k, account_id: ds[0].account_id, position_id: ds[0].position_id, symbol: ds[0].symbol || '?', dir,
      open, close, hold: close - open, volume: vin, openPrice: pin / vin, closePrice: vout ? pout / vout : null,
      profit, commission: comm, swap, fee, net, sl: meta.initial_sl || sl, tp: meta.initial_tp || tp,
      risk, r: risk ? net / risk : null, mfe: meta.mfe ?? null, mae: meta.mae ?? null, deals: ds, j
    });
  }
  trades.sort((a, b) => a.close - b.close);
  S.trades = trades;
  S.tradeMap = new Map(trades.map(t => [t.key, t]));
}

function selAccounts() {
  const id = String(S.accountId);
  if (id === 'all') return S.accounts;
  if (id === 'g:prop') return S.accounts.filter(a => acctType(a) !== 'private');
  if (id === 'g:private') return S.accounts.filter(a => acctType(a) === 'private');
  if (id === 'g:active') return S.accounts.filter(a => acctStatus(a) === 'aktiv');
  return S.accounts.filter(a => String(a.id) === id);
}
let _selSet = null;
function accOk(id) {
  if (S.accountId === 'all') return true;
  if (!_selSet) _selSet = new Set(selAccounts().map(a => String(a.id)));
  return _selSet.has(String(id));
}
function rangeStart() {
  const r = S.range, now = new Date();
  if (r === 'all') return -Infinity;
  if (r === 'ytd') return new Date(now.getFullYear(), 0, 1).getTime();
  const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (+r - 1));
  return d.getTime();
}
function scopedTrades(ignoreRange = false) {
  const st = ignoreRange ? -Infinity : rangeStart();
  return S.trades.filter(t => accOk(t.account_id) && t.close >= st);
}

/* ---------------------------------------------------------------------
   Statistik
   --------------------------------------------------------------------- */
function stats(tr) {
  const n = tr.length;
  const o = { n, wins: 0, losses: 0, be: 0, gp: 0, gl: 0, net: 0, r: 0, rN: 0, hold: 0, costs: 0, best: null, worst: null, wStreak: 0, lStreak: 0 };
  let cw = 0, cl = 0;
  for (const t of tr) {
    o.net += t.net; o.hold += t.hold; o.costs += t.commission + t.swap + t.fee;
    if (t.r != null) { o.r += t.r; o.rN++; }
    if (t.net > 0.005) { o.wins++; o.gp += t.net; cw++; cl = 0; }
    else if (t.net < -0.005) { o.losses++; o.gl += t.net; cl++; cw = 0; }
    else { o.be++; }
    o.wStreak = Math.max(o.wStreak, cw); o.lStreak = Math.max(o.lStreak, cl);
    if (!o.best || t.net > o.best.net) o.best = t;
    if (!o.worst || t.net < o.worst.net) o.worst = t;
  }
  o.winRate = n ? o.wins / (o.wins + o.losses || 1) : null;
  o.pf = o.gl < 0 ? o.gp / -o.gl : (o.gp > 0 ? Infinity : null);
  o.avgWin = o.wins ? o.gp / o.wins : null;
  o.avgLoss = o.losses ? o.gl / o.losses : null;
  o.payoff = (o.avgWin && o.avgLoss) ? o.avgWin / -o.avgLoss : null;
  o.exp = n ? o.net / n : null;
  o.avgR = o.rN ? o.r / o.rN : null;
  o.avgHold = n ? o.hold / n : null;
  return o;
}

// Equity-Kurve inkl. Ein-/Auszahlungen; Drawdown um Cashflows bereinigt
function equitySeries() {
  const ev = [];
  // Mehrere Konten: Startguthaben zusammenfassen statt als Sprünge in der Kurve zu zeigen
  const multi = selAccounts().length > 1;
  let base = 0;
  for (const d of S.deals) if (d.type > 1 && accOk(d.account_id)) { const v = d.profit + d.commission + d.swap + d.fee; if (multi) base += v; else ev.push({ t: d.t, v, cash: true }); }
  for (const t of S.trades) if (accOk(t.account_id)) ev.push({ t: t.close, v: t.net, cash: false, tr: t });
  ev.sort((a, b) => a.t - b.t);
  const st = rangeStart();
  let eq = base, peak = null, maxDD = 0, maxDDAbs = 0;
  const pts = [];
  for (const e of ev) {
    const before = eq;
    eq += e.v;
    if (e.t < st) continue;
    if (peak === null) peak = e.cash ? eq : Math.max(before, eq);
    else if (e.cash) peak += e.v;          // Ein-/Auszahlung verschiebt den Höchststand
    else peak = Math.max(peak, eq);
    const dd = peak > 0 ? (peak - eq) / peak : 0;
    if (dd > maxDD) { maxDD = dd; maxDDAbs = peak - eq; }
    pts.push({ t: e.t, y: eq, cash: e.cash });
  }
  return { pts, maxDD, maxDDAbs, last: eq };
}

function groupBy(tr, fn) {
  const m = new Map();
  for (const t of tr) {
    let keys = fn(t);
    if (!Array.isArray(keys)) keys = [keys];
    for (const k of keys) { if (k == null || k === '') continue; if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
  }
  return [...m.entries()].map(([k, list]) => ({ k, s: stats(list) })).sort((a, b) => b.s.net - a.s.net);
}
function session(t) {
  const h = new Date(t.open).getUTCHours();
  if (h >= 7 && h < 12) return 'London';
  if (h >= 12 && h < 16) return 'London / New York';
  if (h >= 16 && h < 21) return 'New York';
  return 'Asien';
}

/* ---------------------------------------------------------------------
   Datenquelle: Supabase (live)
   --------------------------------------------------------------------- */
const normDeal = r => ({
  account_id: +r.account_id, ticket: +r.ticket, position_id: r.position_id == null ? null : +r.position_id,
  t: +r.time_msc, symbol: r.symbol, type: +r.type, entry: +r.entry, volume: +r.volume || 0, price: +r.price || 0,
  profit: +r.profit || 0, commission: +r.commission || 0, swap: +r.swap || 0, fee: +r.fee || 0,
  sl: r.sl == null ? null : +r.sl, tp: r.tp == null ? null : +r.tp, magic: r.magic, comment: r.comment
});
const normState = r => ({ ...r, account_id: +r.account_id, positions: r.positions || [], updated: Date.parse(r.updated_at) || Date.now() });
const normMeta = r => ({ ...r, initial_risk: r.initial_risk == null ? null : +r.initial_risk, initial_sl: r.initial_sl == null ? null : +r.initial_sl, initial_tp: r.initial_tp == null ? null : +r.initial_tp, mfe: r.mfe == null ? null : +r.mfe, mae: r.mae == null ? null : +r.mae });

// Screenshots vor dem Upload verkleinern: max. 1920 px breit, WebP (Fallback JPEG).
// Ein Chart-Screenshot landet so bei ca. 60–150 KB statt 1–4 MB und bleibt gut lesbar.
const SHOT_MAX_W = 1920, SHOT_MAX_H = 1920;
async function shrinkImage(file) {
  try {
    if (!/^image\//.test(file.type) || /gif|svg/.test(file.type)) return file;
    const bmp = await createImageBitmap(file);
    const sc = Math.min(1, SHOT_MAX_W / bmp.width, SHOT_MAX_H / bmp.height);
    const w = Math.round(bmp.width * sc), h = Math.round(bmp.height * sc);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.drawImage(bmp, 0, 0, w, h);
    bmp.close && bmp.close();
    const enc = (type, q) => new Promise(r => cv.toBlob(r, type, q));
    let blob = await enc('image/webp', 0.82), ext = 'webp';
    if (!blob || blob.type !== 'image/webp') { blob = await enc('image/jpeg', 0.85); ext = 'jpg'; }
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], (file.name.replace(/\.[^.]+$/, '') || 'screenshot') + '.' + ext, { type: blob.type });
  } catch (e) { return file; }
}

const Live = {
  sb: null, ch: null, shotCache: {},
  create(url, key) {
    this.sb = window.supabase.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  },
  async session() { const { data } = await this.sb.auth.getSession(); return data.session; },
  async signIn(email, pw) { const { error } = await this.sb.auth.signInWithPassword({ email, password: pw }); if (error) throw error; },
  async signUp(email, pw) {
    const { data, error } = await this.sb.auth.signUp({ email, password: pw, options: { emailRedirectTo: location.href.split('#')[0] } });
    if (error) throw error; return data;
  },
  async signOut() { await this.sb.auth.signOut(); location.reload(); },
  async all(table, orders = []) {
    let out = [], from = 0; const size = 1000;
    for (;;) {
      let q = this.sb.from(table).select('*').range(from, from + size - 1);
      for (const o of orders) q = q.order(o, { ascending: true });
      const { data, error } = await q;
      if (error) throw error;
      out = out.concat(data);
      if (data.length < size) break;
      from += size;
    }
    return out;
  },
  async load() {
    const { data: u } = await this.sb.auth.getUser();
    S.user = u.user;
    const [acc, deals, states, meta, jr, daily, settings, tokens] = await Promise.all([
      this.all('accounts', ['id']), this.all('deals', ['time_msc', 'ticket']), this.all('account_state', ['account_id']),
      this.all('position_meta', ['account_id', 'position_id']), this.all('trade_journal', ['account_id', 'position_id']),
      this.all('daily_journal', ['day']), this.all('user_settings'), this.all('sync_tokens', ['created_at'])
    ]);
    S.accounts = acc;
    S.deals = deals.map(normDeal);
    S.states = Object.fromEntries(states.map(r => [r.account_id, normState(r)]));
    S.meta = Object.fromEntries(meta.map(r => [tkey(r.account_id, r.position_id), normMeta(r)]));
    S.journal = Object.fromEntries(jr.map(r => [tkey(r.account_id, r.position_id), r]));
    S.daily = Object.fromEntries(daily.map(r => [r.day, r]));
    S.tokens = tokens;
    if (settings[0] && settings[0].data) S.settings = mergeSettings(settings[0].data);
  },
  async refresh() {
    try {
      const since = S.deals.length ? S.deals[S.deals.length - 1].t - 86400000 * 3 : 0;
      const [{ data: deals }, states, meta, acc] = await Promise.all([
        this.sb.from('deals').select('*').gte('time_msc', since).order('time_msc').limit(5000),
        this.all('account_state'), this.all('position_meta'), this.all('accounts', ['id'])
      ]);
      S.accounts = acc;
      for (const r of deals || []) upsertDeal(normDeal(r));
      S.states = Object.fromEntries(states.map(r => [r.account_id, normState(r)]));
      S.meta = Object.fromEntries(meta.map(r => [tkey(r.account_id, r.position_id), normMeta(r)]));
      dataChanged();
    } catch (e) { console.warn(e); }
  },
  subscribe() {
    if (this.ch) this.sb.removeChannel(this.ch);
    this.ch = this.sb.channel('tj-live-' + Date.now())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deals' }, p => { if (p.new && p.new.ticket != null) onNewDeal(normDeal(p.new)); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'account_state' }, p => { if (p.new && p.new.account_id) onState(normState(p.new)); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'position_meta' }, p => {
        if (!p.new || !p.new.account_id) return;
        const k = tkey(p.new.account_id, p.new.position_id);
        S.meta[k] = normMeta(p.new);
        if (S.tradeMap.has(k)) scheduleRebuild();   // nur bei bereits geschlossenen Trades relevant
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts' }, p => {
        if (!p.new || !p.new.id) return;
        const i = S.accounts.findIndex(a => a.id === p.new.id);
        if (i < 0) { S.accounts.push(p.new); scheduleRebuild(); return; }
        const old = S.accounts[i];
        const relevant = old.label !== p.new.label || JSON.stringify(old.prop || {}) !== JSON.stringify(p.new.prop || {}) || old.server_offset !== p.new.server_offset;
        S.accounts[i] = p.new;                        // last_sync_at ändert sich bei jedem Sync – kein Neuaufbau nötig
        if (relevant) scheduleRebuild(); else updateLive();
      })
      .subscribe(st => { S.rt = st === 'SUBSCRIBED' ? 'on' : (st === 'CLOSED' || st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') ? 'err' : 'off'; updateConn(); });
  },
  async saveJournal(row) {
    const { error } = await this.sb.from('trade_journal').upsert({ ...row, user_id: S.user.id, updated_at: new Date().toISOString() });
    if (error) throw error;
  },
  async saveDaily(row) {
    const { error } = await this.sb.from('daily_journal').upsert({ ...row, user_id: S.user.id, updated_at: new Date().toISOString() });
    if (error) throw error;
  },
  async saveSettings() {
    const { error } = await this.sb.from('user_settings').upsert({ user_id: S.user.id, data: S.settings, updated_at: new Date().toISOString() });
    if (error) throw error;
  },
  async saveAccountLabel(id, label) {
    const { error } = await this.sb.from('accounts').update({ label }).eq('id', id);
    if (error) throw error;
  },
  async saveAccount(id, patch) {
    const { error } = await this.sb.from('accounts').update(patch).eq('id', id);
    if (error) throw error;
  },
  async createToken(label) {
    const { data, error } = await this.sb.from('sync_tokens').insert({ label, user_id: S.user.id }).select().single();
    if (error) throw error;
    S.tokens.push(data); return data.token;
  },
  async deleteToken(token) {
    const { error } = await this.sb.from('sync_tokens').delete().eq('token', token);
    if (error) throw error;
    S.tokens = S.tokens.filter(t => t.token !== token);
  },
  async upload(file, k) {
    file = await shrinkImage(file);
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${S.user.id}/${k.replace(':', '-')}/${Date.now()}.${ext}`;
    const { error } = await this.sb.storage.from('screenshots').upload(path, file, { contentType: file.type || 'image/png', upsert: false });
    if (error) throw error;
    return path;
  },
  async removeShot(path) { await this.sb.storage.from('screenshots').remove([path]); delete this.shotCache[path]; },
  async usage() { const { data, error } = await this.sb.rpc('storage_usage'); if (error) throw error; return data; },
  async shotUrl(path) {
    const c = this.shotCache[path];
    if (c && c.exp > Date.now()) return c.url;
    const { data, error } = await this.sb.storage.from('screenshots').createSignedUrl(path, 3600);
    if (error) return '';
    this.shotCache[path] = { url: data.signedUrl, exp: Date.now() + 3300e3 };
    return data.signedUrl;
  }
};

function mergeSettings(d) {
  const o = structuredClone(DEFAULTS);
  for (const k of Object.keys(DEFAULTS)) if (Array.isArray(d[k])) o[k] = d[k];
  return o;
}
function upsertDeal(d) {
  const i = S.deals.findIndex(x => x.account_id === d.account_id && x.ticket === d.ticket);
  if (i >= 0) { S.deals[i] = d; return false; }
  S.deals.push(d);
  if (S.deals.length > 1 && S.deals[S.deals.length - 2].t > d.t) S.deals.sort((a, b) => a.t - b.t || a.ticket - b.ticket);
  return true;
}
function onNewDeal(d) {
  const isNew = upsertDeal(d);
  scheduleRebuild(() => {
    if (!isNew || d.entry === 0 || d.type > 1) return;
    const t = S.tradeMap.get(tkey(d.account_id, d.position_id));
    if (t && Date.now() - d.t < 15 * 60e3) toast(`${ic('bolt')} <span><b>${esc(t.symbol)}</b> geschlossen · <b class="${cls(t.net)}">${money(t.net, true)}</b>${t.r != null ? ' · ' + rFmt(t.r) : ''}</span>`, 6000);
  });
}
function onState(st) {
  S.states[st.account_id] = st;
  if (!S.accounts.find(a => a.id === st.account_id)) { DS.refresh && DS.refresh(); return; }
  updateLive();
}

/* ---------------------------------------------------------------------
   Datenquelle: Demo (generierte Beispieldaten, simuliert Live-Ticks)
   --------------------------------------------------------------------- */
const Demo = {
  timer: null,
  async load() {
    S.user = { id: 'demo', email: 'demo@trading-journal' };
    const g = genDemo();
    Object.assign(S, g);
  },
  subscribe() {
    S.rt = 'on'; updateConn();
    let ticks = 0;
    this.timer = setInterval(() => {
      ticks++;
      const st = S.states[1];
      if (!st) return;
      for (const p of st.positions) {
        const step = p.symbol === 'XAUUSD' ? 0.35 : p.symbol === 'NAS100' ? 3 : 0.00012;
        p.price = +(p.price + (Math.random() - 0.48) * step * (p.type === 0 ? 1 : -1)).toFixed(5);
        const pv = p.symbol === 'XAUUSD' ? 100 : p.symbol === 'NAS100' ? 1 : 100000;
        p.profit = +((p.price - p.open_price) * (p.type === 0 ? 1 : -1) * p.volume * pv).toFixed(2);
        p.mfe = Math.max(p.mfe, p.profit); p.mae = Math.min(p.mae, p.profit);
      }
      st.profit = st.positions.reduce((s, p) => s + p.profit + p.swap, 0);
      st.equity = st.balance + st.profit;
      st.free_margin = st.equity - st.margin;
      st.margin_level = st.margin ? st.equity / st.margin * 100 : 0;
      st.updated = Date.now();
      // Nach ~40 s wird eine Demo-Position geschlossen → zeigt den Live-Push
      if (ticks === 20 && st.positions.length) {
        const p = st.positions.shift();
        const d = { account_id: 1, ticket: 990001, position_id: p.id, t: Date.now(), symbol: p.symbol, type: p.type === 0 ? 1 : 0, entry: 1, volume: p.volume, price: p.price, profit: p.profit, commission: p.symbol === 'XAUUSD' ? -3 * p.volume : 0, swap: 0, fee: 0, sl: null, tp: null };
        S.meta[tkey(1, p.id)] = { initial_risk: p.risk, initial_sl: p.sl, initial_tp: p.tp, mfe: p.mfe, mae: p.mae };
        st.balance += d.profit + d.commission;
        st.margin = Math.max(0, st.margin - 1500);
        onNewDeal(d);
      }
      updateLive();
    }, 2000);
  },
  async refresh() { },
  async saveJournal(row) { S.journal[tkey(row.account_id, row.position_id)] = row; },
  async saveDaily(row) { S.daily[row.day] = row; },
  async saveSettings() { },
  async saveAccountLabel(id, label) { const a = S.accounts.find(x => x.id === id); if (a) a.label = label; },
  async saveAccount() { },
  async createToken(label) { const t = Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join(''); S.tokens.push({ token: t, label, created_at: new Date().toISOString() }); return t; },
  async deleteToken(token) { S.tokens = S.tokens.filter(t => t.token !== token); },
  async upload(file) { file = await shrinkImage(file); return await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); },
  async usage() { return { shot_bytes: 0, shot_count: 0, db_bytes: 0, demo: true }; },
  async removeShot() { },
  async shotUrl(p) { return p; },
  async signOut() { LS.del('mode'); location.reload(); }
};

function genDemo() {
  let seed = 20261115;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const SY = {
    EURUSD: { p: 1.085, pv: 100000, d: [0.0010, 0.0032], c: 3.5, w: 5 }, GBPUSD: { p: 1.27, pv: 100000, d: [0.0013, 0.0040], c: 3.5, w: 3 },
    USDJPY: { p: 149.5, pv: 668, d: [0.12, 0.42], c: 3.5, w: 2 }, XAUUSD: { p: 2380, pv: 100, d: [2.5, 11], c: 3, w: 5 },
    NAS100: { p: 19800, pv: 1, d: [22, 75], c: 0, w: 4 }, US30: { p: 41500, pv: 1, d: [35, 110], c: 0, w: 2 }
  };
  const pool = Object.entries(SY).flatMap(([k, v]) => Array(v.w).fill(k));
  const setupEdge = { 'Breakout': 0.05, 'Pullback': 0.09, 'Trendfolge': 0.06, 'Range': -0.03, 'Reversal': -0.07, 'Liquidity Sweep': 0.04, 'News': -0.1 };
  const notesW = ['Sauberer Retest der Zone, Einstieg nach Bestätigungskerze. Plan exakt umgesetzt.', 'Struktur-Bruch auf M15, Ziel am Tageshoch. Teilgewinn bei 1R mitgenommen.', 'Gutes Timing in der London-Eröffnung. Geduldig gewartet, bis der Preis zu mir kam.', 'Trend war klar, Pullback in die 50 %-Zone. Nichts zu verbessern.'];
  const notesL = ['Zu früh eingestiegen, Bestätigung fehlte. Nächstes Mal Schlusskurs abwarten.', 'News nicht auf dem Schirm gehabt – Spike hat mich ausgestoppt.', 'Setup war ok, Markt hat einfach nicht mitgespielt. Verlust im Rahmen.', 'Gegen den Higher-Timeframe-Trend gehandelt. Regel: nur mit H4-Trend.'];
  const now = Date.now(), D = 864e5;
  const accounts = [
    { id: 1, login: 17208841, server: 'FundedNext-Server', broker: 'FundedNext', name: 'Demo Trader', currency: 'USD', leverage: 100, is_demo: true, server_offset: 7200, label: 'Stellar 2-Step 100k', prop: { type: 'fundednext', preset: 'fn-2step-p2', status: 'aktiv' } },
    { id: 2, login: 17113520, server: 'FundedNext-Server 2', broker: 'FundedNext', name: 'Demo Trader', currency: 'USD', leverage: 30, is_demo: true, server_offset: 7200, label: 'Stellar 1-Step 25k', prop: { type: 'fundednext', preset: 'fn-1step-f', status: 'aktiv' } },
    { id: 3, login: 16981207, server: 'FundedNext-Server', broker: 'FundedNext', name: 'Demo Trader', currency: 'USD', leverage: 100, is_demo: true, server_offset: 7200, label: 'Stellar 2-Step 50k', prop: { type: 'fundednext', preset: 'fn-2step-p1', status: 'nicht-bestanden' } },
    { id: 4, login: 52004417, server: 'Broker-Live', broker: 'Privatbroker (Beispiel)', name: 'Demo Trader', currency: 'USD', leverage: 30, is_demo: false, server_offset: 7200, label: 'Privatkonto', prop: { type: 'private' } }
  ];
  const plans = [
    { acc: 1, size: 100000, from: now - 34 * D, to: now - 3 * 3600e3, risk: [0.0025, 0.005], edge: 0.05 },
    { acc: 2, size: 25000, from: now - 150 * D, to: now - 5 * 3600e3, risk: [0.003, 0.006], edge: 0.03 },
    { acc: 3, size: 50000, from: now - 232 * D, to: now - 196 * D, risk: [0.009, 0.016], edge: -0.22 },
    { acc: 4, size: 10000, from: now - 90 * D, to: now - 2 * D, risk: [0.005, 0.01], edge: 0 }
  ];
  const deals = [], meta = {}, journal = {}, daily = {}, bals = {};
  let tk = 7000001, pos = 4100001;
  for (const pl of plans) {
    deals.push({ account_id: pl.acc, ticket: tk++, position_id: null, t: pl.from - D, symbol: null, type: 2, entry: 0, volume: 0, price: 0, profit: pl.size, commission: 0, swap: 0, fee: 0, comment: 'Initial balance' });
    let t = pl.from, bal = pl.size;
    while (t < pl.to) {
      t += (3 + rnd() * 26) * 3600e3;
      const dt = new Date(t);
      if (dt.getDay() === 0 || dt.getDay() === 6) continue;
      dt.setHours(8 + Math.floor(rnd() * 11), Math.floor(rnd() * 60), Math.floor(rnd() * 60));
      const open = dt.getTime();
      if (open > pl.to) break;
      const sym = pick(pool), s = SY[sym];
      const dir = rnd() < 0.55 ? 0 : 1, sg = dir === 0 ? 1 : -1;
      const risk = Math.round((pl.size * (pl.risk[0] + rnd() * (pl.risk[1] - pl.risk[0]))) / 5) * 5;
      const dist = s.d[0] + rnd() * (s.d[1] - s.d[0]);
      const vol = Math.max(0.01, Math.round(risk / (dist * s.pv) * 100) / 100);
      const realRisk = dist * vol * s.pv;
      const setup = pick(Object.keys(setupEdge));
      const progress = (open - pl.from) / Math.max(1, pl.to - pl.from);
      const pWin = 0.41 + pl.edge + setupEdge[setup] + progress * 0.06;
      const u = rnd();
      const R = u < pWin ? 0.7 + rnd() * rnd() * 3.4 : (u < pWin + 0.06 ? (rnd() - 0.5) * 0.08 : -(0.75 + rnd() * 0.3));
      const op = s.p * (1 + Math.sin(open / 2e9) * 0.04 + (rnd() - 0.5) * 0.01), cp = op + sg * R * dist;
      const profit = +((cp - op) * sg * vol * s.pv).toFixed(2);
      const hold = (8 + rnd() * rnd() * 480) * 60e3, close = open + hold;
      const comm = -s.c * vol;
      const swap = hold > 10 * 3600e3 ? -+(vol * (2 + rnd() * 5)).toFixed(2) : 0;
      const id = pos++;
      const sl = op - sg * dist, tp = op + sg * dist * (1.5 + Math.round(rnd() * 3) / 2);
      deals.push({ account_id: pl.acc, ticket: tk++, position_id: id, t: open, symbol: sym, type: dir, entry: 0, volume: vol, price: op, profit: 0, commission: comm, swap: 0, fee: 0, sl, tp });
      deals.push({ account_id: pl.acc, ticket: tk++, position_id: id, t: close, symbol: sym, type: 1 - dir, entry: 1, volume: vol, price: cp, profit, commission: comm, swap, fee: 0, sl, tp });
      bal += profit + comm * 2 + swap;
      const win = profit > 0;
      meta[tkey(pl.acc, id)] = {
        initial_risk: +realRisk.toFixed(2), initial_sl: sl, initial_tp: tp,
        mfe: +(win ? profit * (1 + rnd() * 0.5) : realRisk * rnd() * 0.7).toFixed(2),
        mae: +(win ? -realRisk * rnd() * 0.85 : profit * (1 + rnd() * 0.05)).toFixed(2)
      };
      if (rnd() < 0.72) {
        const mistakes = !win && rnd() < 0.55 ? [pick(DEFAULTS.mistakes)] : (win && rnd() < 0.1 ? ['Zu früh raus'] : []);
        if (setup === 'News' && rnd() < 0.5) mistakes.push('FOMO');
        const tags = [new Date(open).getUTCHours() < 12 ? 'London' : 'New York'];
        if (rnd() < 0.25) tags.push(win ? 'A+ Setup' : 'Gegen Trend');
        journal[tkey(pl.acc, id)] = {
          account_id: pl.acc, position_id: id, setup, tags, mistakes: [...new Set(mistakes)],
          emotion: win ? pick(['Ruhig', 'Fokussiert', 'Zuversichtlich']) : pick(['Ungeduldig', 'Nervös', 'Frustriert', 'Ruhig', 'Gierig']),
          rating: win ? 3 + Math.round(rnd() * 2) : 1 + Math.round(rnd() * 2),
          plan_followed: mistakes.length === 0, planned_risk: null,
          notes: win ? pick(notesW) : pick(notesL), screenshots: []
        };
      }
      const dk = dayKey(open);
      if (!daily[dk] && rnd() < 0.4) daily[dk] = { day: dk, mood: 2 + Math.round(rnd() * 3), plan: 'Fokus auf ' + sym + '. Nur A-Setups, max. 3 Trades.', review: win ? 'Disziplinierter Tag, Regeln eingehalten.' : 'Ungeduldig gewesen – mehr warten.', lessons: win ? 'Geduld zahlt sich aus.' : 'Kein Trade ohne Bestätigung.' };
    }
    bals[pl.acc] = bal;
  }
  // Offene Positionen auf dem aktiven 100k-Konto
  const positions = [
    { id: pos++, ticket: 0, symbol: 'XAUUSD', type: 0, volume: 0.6, open_price: 2391.4, price: 2396.85, sl: 2382.9, tp: 2414.0, profit: 0, swap: 0, t: now - 95 * 60e3, risk: 510, mfe: 420, mae: -120, comment: '' },
    { id: pos++, ticket: 0, symbol: 'EURUSD', type: 1, volume: 2.1, open_price: 1.08642, price: 1.08561, sl: 1.08880, tp: 1.08150, profit: 0, swap: -4.2, t: now - 40 * 60e3, risk: 500, mfe: 230, mae: -90, comment: '' }
  ];
  for (const p of positions) { deals.push({ account_id: 1, ticket: tk++, position_id: p.id, t: p.t, symbol: p.symbol, type: p.type, entry: 0, volume: p.volume, price: p.open_price, profit: 0, commission: p.symbol === 'XAUUSD' ? -3 * p.volume : -3.5 * p.volume, swap: 0, fee: 0, sl: p.sl, tp: p.tp }); bals[1] += p.symbol === 'XAUUSD' ? -3 * p.volume : -3.5 * p.volume; }
  for (const p of positions) { p.ticket = p.id; p.profit = +((p.price - p.open_price) * (p.type === 0 ? 1 : -1) * p.volume * (p.symbol === 'XAUUSD' ? 100 : 100000)).toFixed(2); }
  const fl = positions.reduce((s, p) => s + p.profit + p.swap, 0);
  const mkState = (id, bal, posi, upd, fl = 0) => ({ account_id: id, balance: bal, equity: bal + fl, margin: posi.length ? 3100 : 0, free_margin: bal + fl - (posi.length ? 3100 : 0), margin_level: posi.length ? (bal + fl) / 3100 * 100 : 0, profit: fl, positions: posi, updated: upd });
  const states = {
    1: mkState(1, bals[1], positions, now, fl),
    2: mkState(2, bals[2], [], now - 20e3),
    3: mkState(3, bals[3], [], now - 196 * D),
    4: mkState(4, bals[4], [], now - 2 * D)
  };
  const tokens = [{ token: 'demo' + 'f'.repeat(44), label: 'MT5 MacBook', created_at: new Date(now - 200 * D).toISOString(), last_used_at: new Date().toISOString() }];
  return { accounts, deals: deals.sort((a, b) => a.t - b.t || a.ticket - b.ticket), meta, journal, daily, states, tokens, settings: structuredClone(DEFAULTS) };
}

/* ---------------------------------------------------------------------
   Rendering – Grundgerüst
   --------------------------------------------------------------------- */
const charts = [];
function killCharts() { while (charts.length) { try { charts.pop().destroy(); } catch (e) { } } }

// „Journal aktualisieren“: iPhone -> Kurzbefehl „Journal Update“ (weckt den Mac, stößt den MT5-Export an);
// Mac -> direkt Hammerspoon (exportiert die MT5-Historie, der Import-Dienst lädt sie hoch). Kein EA.
const MAC_SHORTCUT = 'Journal Update';
const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_MAC = !IS_IOS && /Macintosh|Mac OS X/.test(navigator.userAgent);
const UPDATE_LINK = IS_IOS ? `shortcuts://run-shortcut?name=${encodeURIComponent(MAC_SHORTCUT)}` : 'hammerspoon://journal-export';

function shell() {
  $('#root').innerHTML = `
  <div class="app">
    <aside class="side">
      <div class="brand"><div class="logo">${ic('chart')}</div><div>Trading Journal<small>MetaTrader 5 Live-Sync</small></div></div>
      <nav class="nav">${VIEWS.map(v => `<a href="#${v.id}" data-view="${v.id}">${ic(v.icon)}<span>${v.label}</span></a>`).join('')}</nav>
      <div class="grow"></div>
      <div class="conn" id="conn-side"></div>
    </aside>
    <div class="main">
      ${S.mode === 'demo' ? `<div class="demo-banner">${ic('bolt')}<span>Demo mit Beispieldaten<span class="hide-m"> – Live-Ticks werden simuliert</span></span><span style="flex:1"></span><button class="btn sm" data-act="demo-exit">Eigene Daten verbinden</button></div>` : ''}
      <header class="top">
        <h1 id="title"></h1>
        <div class="seg" id="ranges">${RANGES.map(([k, l]) => `<button data-act="range" data-v="${k}">${l}</button>`).join('')}</div>
        <select id="accsel" aria-label="Konto"></select>
        ${S.mode === 'live' && (IS_IOS || IS_MAC) ? `<a class="btn sm" id="macsync" href="${UPDATE_LINK}" title="Exportiert die MT5-Historie und importiert sie ins Journal">${ic('sync')}<span>Journal aktualisieren</span></a>` : ''}
      </header>
      <main class="view" id="view"></main>
    </div>
  </div>
  <nav class="tabbar">${VIEWS.map(v => `<a href="#${v.id}" data-view="${v.id}">${ic(v.icon)}<span>${v.label === 'Einstellungen' ? 'Mehr' : v.label === 'Übersicht' ? 'Start' : v.label}</span></a>`).join('')}</nav>
  <div id="modal"></div><div class="toasts" id="toasts"></div>`;
  const ms = $('#macsync'); if (ms) ms.addEventListener('click', () => toast(IS_IOS ? 'Mac wird geweckt – ist er gesperrt, kommt die Entsperr-Nachricht. Danach aktualisiert sich das Journal von selbst.' : 'Export läuft – das Journal aktualisiert sich in ca. 1 Minute von selbst.'));
  $('#accsel').addEventListener('change', e => { S.accountId = e.target.value; _selSet = null; LS.set('account', S.accountId); render(); });
}

function fillAccSel() {
  const sel = $('#accsel'); if (!sel) return;
  const types = new Set(S.accounts.map(acctType));
  const hasProp = [...types].some(t => t !== 'private'), hasPriv = types.has('private');
  const inactive = S.accounts.some(a => acctStatus(a) !== 'aktiv');
  let h = `<option value="all">Alle Konten</option>`;
  if (inactive) h += `<option value="g:active">Alle aktiven Konten</option>`;
  if (hasProp && hasPriv) h += `<option value="g:prop">Alle Prop-Konten</option><option value="g:private">Alle Privatkonten</option>`;
  for (const [t, title] of ACC_TYPES) {
    const list = S.accounts.filter(a => acctType(a) === t);
    if (!list.length) continue;
    h += `<optgroup label="${esc(title)}">${list.map(a => `<option value="${a.id}">${esc(accName(a))}${acctStatus(a) !== 'aktiv' ? ' · ' + statusLabel(acctStatus(a)) : ''}</option>`).join('')}</optgroup>`;
  }
  sel.innerHTML = h;
  const valid = ['all', 'g:active', 'g:prop', 'g:private'].includes(String(S.accountId)) || S.accounts.find(a => String(a.id) === String(S.accountId));
  if (!valid) { S.accountId = 'all'; _selSet = null; }
  sel.value = String(S.accountId);
  if (!sel.value) { S.accountId = 'all'; sel.value = 'all'; _selSet = null; }
  sel.style.display = S.accounts.length > 1 ? '' : 'none';
}
const accName = a => a.label || `${a.broker || a.server || 'Konto'} · ${a.login}`;

function render() {
  if (S.editing) { S.pendingRender = true; return; }
  S.pendingRender = false;
  _selSet = null;
  const v = VIEWS.find(x => x.id === S.view) || VIEWS[0];
  $('#title').textContent = v.label;
  $$('[data-view]').forEach(a => a.classList.toggle('on', a.dataset.view === v.id));
  $$('#ranges button').forEach(b => b.classList.toggle('on', b.dataset.v === S.range));
  $('#ranges').style.display = (v.id === 'einstellungen' || v.id === 'kalender' || v.id === 'konten') ? 'none' : '';
  fillAccSel();
  killCharts();
  const view = $('#view');
  view.innerHTML = ({ dashboard: vDashboard, trades: vTrades, kalender: vCalendar, statistik: vStats, konten: vAccounts, einstellungen: vSettings }[v.id])();
  (AFTER[v.id] || (() => { }))();
  updateConn();
}

let rebuildT = null, rebuildCbs = [];
function scheduleRebuild(cb) {
  if (cb) rebuildCbs.push(cb);
  clearTimeout(rebuildT);
  rebuildT = setTimeout(() => { buildTrades(); render(); const cbs = rebuildCbs; rebuildCbs = []; cbs.forEach(f => f()); }, 250);
}
function dataChanged() { scheduleRebuild(); }

function updateConn() {
  const el = $('#conn-side'); if (!el) return;
  const sts = selAccounts().map(a => S.states[a.id]).filter(Boolean);
  const last = sts.length ? Math.max(...sts.map(s => s.updated)) : 0;
  const fresh = last && Date.now() - last < 90e3;
  let dot = 'off', txt = 'Keine MT5-Daten';
  if (S.rt !== 'on') { dot = 'warn'; txt = 'Verbinde Echtzeit …'; }
  else if (fresh) { dot = 'live'; txt = 'MT5 live · ' + ago(last); }
  else if (last) { dot = 'warn'; txt = 'MT5 zuletzt ' + ago(last); }
  el.innerHTML = `<span class="dot ${dot}"></span><span>${txt}</span>`;
}

/* ---------------------------------------------------------------------
   Ansicht: Übersicht
   --------------------------------------------------------------------- */
function liveZone() {
  const accs = selAccounts();
  if (!accs.length) return onboardingCard();
  const sts = accs.filter(a => acctStatus(a) === 'aktiv' || accs.length === 1).map(a => S.states[a.id]).filter(Boolean);
  const sum = k => sts.reduce((s, x) => s + (+x[k] || 0), 0);
  const eq = sum('equity'), bal = sum('balance'), fl = sum('profit'), mg = sum('margin'), fm = sum('free_margin');
  const ml = mg ? eq / mg * 100 : null;
  const last = sts.length ? Math.max(...sts.map(s => s.updated)) : 0;
  const fresh = last && Date.now() - last < 90e3;
  const positions = sts.flatMap(s => s.positions.map(p => ({ ...p, account_id: s.account_id })));
  const startDay = new Date(); startDay.setHours(0, 0, 0, 0);
  const today = S.trades.filter(t => accOk(t.account_id) && t.close >= startDay.getTime()).reduce((s, t) => s + t.net, 0);
  return `
  <div class="card live" style="margin-bottom:16px">
    <div><div class="lab"><span class="dot ${fresh ? 'live' : last ? 'warn' : 'off'}"></span>Equity ${fresh ? '· live' : last ? '· ' + ago(last) : ''}</div>
      <div class="big num" style="margin-top:8px">${sts.length ? money(eq) : '–'}</div>
      <div class="muted" style="font-size:12.5px;margin-top:2px">${accs.length === 1 ? esc(accName(accs[0])) + (accs[0].is_demo ? ' · Demo' : '') : sts.length + ' aktive Konten'}</div></div>
    <div><div class="lab">Balance</div><div class="val num">${sts.length ? money(bal) : '–'}</div></div>
    <div><div class="lab">Offener P/L</div><div class="val num ${cls(fl)}">${sts.length ? money(fl, true) : '–'}</div></div>
    <div><div class="lab">Heute realisiert</div><div class="val num ${cls(today)}">${money(today, true)}</div></div>
    <div><div class="lab">Margin-Level</div><div class="val num">${ml ? nf(0).format(ml) + ' %' : '–'}</div><div class="dim num" style="font-size:12px">frei ${sts.length ? money(fm) : '–'}</div></div>
  </div>
  ${ruleMonitor(accs)}
  <div class="card" style="margin-bottom:16px">
    <h3>Offene Positionen <span class="badge">${positions.length}</span><span class="sp"></span></h3>
    ${positions.length ? `<div class="tcards">${positions.map(p => {
        const r = p.risk > 0 ? (p.profit + (p.swap || 0)) / p.risk : null;
        return `<div class="tcard"><div class="a"><span class="sym">${esc(p.symbol)}</span><span class="badge ${p.type === 0 ? 'long' : 'short'}">${p.type === 0 ? 'Long' : 'Short'}</span><span class="dim num" style="font-size:12px">${num(p.volume)} Lot</span></div>
          <div class="b num ${cls(p.profit)}">${money(p.profit + (p.swap || 0), true)}</div>
          <div class="c num">${price(p.open_price)} → ${price(p.price)} · ${dur(Date.now() - p.t)}</div><div class="d num ${cls(r)}">${rFmt(r)}</div></div>`;
      }).join('')}</div><div class="tblwrap"><table class="tbl trades">
      <thead><tr><th>Symbol</th><th>Richtung</th><th class="r">Volumen</th><th class="r">Einstieg</th><th class="r">Aktuell</th><th class="r">SL / TP</th><th class="r">Laufzeit</th><th class="r">R</th><th class="r">P/L</th></tr></thead>
      <tbody>${positions.map(p => {
        const r = p.risk > 0 ? (p.profit + (p.swap || 0)) / p.risk : null;
        return `<tr><td class="sym">${esc(p.symbol)}</td><td><span class="badge ${p.type === 0 ? 'long' : 'short'}">${p.type === 0 ? 'Long' : 'Short'}</span></td>
        <td class="r num">${num(p.volume)}</td><td class="r num">${price(p.open_price)}</td><td class="r num">${price(p.price)}</td>
        <td class="r num dim">${price(p.sl)} / ${price(p.tp)}</td><td class="r dim">${dur(Date.now() - p.t)}</td>
        <td class="r num ${cls(r)}">${rFmt(r)}</td><td class="r num ${cls(p.profit)}" style="font-weight:600">${money(p.profit + (p.swap || 0), true)}</td></tr>`;
      }).join('')}</tbody></table></div>` : `<div class="empty" style="padding:16px">Keine offenen Positionen</div>`}
  </div>`;
}

function onboardingCard() {
  return `<div class="card" style="margin-bottom:16px;border-color:rgba(91,140,255,.4);background:linear-gradient(135deg,rgba(91,140,255,.08),transparent)">
    <h3 style="color:var(--tx);font-size:15px">${ic('bolt')} Verbinde MetaTrader 5</h3>
    <p class="muted" style="margin:0 0 14px">Noch keine Daten empfangen. Erstelle unter <b>Einstellungen</b> einen Sync-Token und trage ihn im Expert Advisor <b>TradingJournalSync</b> ein. Danach erscheinen Historie, Kontostand und offene Positionen hier automatisch – in Echtzeit.</p>
    <a class="btn pri" href="#einstellungen">${ic('key')} Sync-Token erstellen</a></div>`;
}

function vDashboard() {
  const tr = scopedTrades();
  const s = stats(tr);
  const eqs = equitySeries();
  const recent = tr.slice(-8).reverse();
  return `
  <div id="live-zone">${liveZone()}</div>
  <div class="kpis">
    ${kpi('Netto-P/L', `<span class="${cls(s.net)}">${money(s.net, true)}</span>`, `${s.n} Trades`)}
    ${kpi('Trefferquote', pct(s.winRate), `${s.wins} G · ${s.losses} V${s.be ? ' · ' + s.be + ' BE' : ''}`)}
    ${kpi('Profit-Faktor', s.pf == null ? '–' : s.pf === Infinity ? '∞' : num(s.pf), `Payoff ${num(s.payoff)}`)}
    ${kpi('Erwartungswert', `<span class="${cls(s.exp)}">${money(s.exp, true)}</span>`, 'pro Trade')}
    ${kpi('Ø R-Multiple', `<span class="${cls(s.avgR)}">${rFmt(s.avgR)}</span>`, `Summe ${rFmt(s.rN ? s.r : null)}`)}
    ${kpi('Max. Drawdown', `<span class="${eqs.maxDD > 0 ? 'neg' : ''}">${pct(-eqs.maxDD, 2)}</span>`, money(-eqs.maxDDAbs))}
  </div>
  <div class="grid g32" style="margin-top:16px">
    <div class="card"><h3>Equity-Kurve<span class="sp"></span><span class="dim num" style="font-weight:500">${money(eqs.last)}</span></h3><div class="chartbox"><canvas id="c-eq"></canvas></div></div>
    <div class="card"><h3>Tages-P/L <span class="dim" style="font-weight:500">letzte 30 Handelstage</span></h3><div class="chartbox"><canvas id="c-daily"></canvas></div></div>
  </div>
  <div class="card" style="margin-top:16px">
    <h3>Letzte Trades<span class="sp"></span><a href="#trades" class="btn sm ghost">Alle ${ic('right')}</a></h3>
    ${recent.length ? tradeTable(recent, true) : `<div class="empty">Noch keine abgeschlossenen Trades im Zeitraum.</div>`}
  </div>`;
}
const kpi = (l, v, s = '') => `<div class="kpi"><div class="l">${l}</div><div class="v num">${v}</div><div class="s">${s}</div></div>`;

function updateLive() {
  _selSet = null;
  updateConn();
  if (S.view === 'dashboard' && !S.editing) { const z = $('#live-zone'); if (z) z.innerHTML = liveZone(); }
}

/* ---------------------------------------------------------------------
   Ansicht: Trades
   --------------------------------------------------------------------- */
function filteredTrades() {
  const f = S.filters, q = f.q.trim().toLowerCase();
  let tr = scopedTrades().filter(t => {
    const j = t.j || {};
    if (f.symbol && t.symbol !== f.symbol) return false;
    if (f.side && t.dir !== f.side) return false;
    if (f.setup && j.setup !== f.setup) return false;
    if (f.tag && !(j.tags || []).includes(f.tag) && !(j.mistakes || []).includes(f.tag)) return false;
    if (f.result === 'win' && !(t.net > 0)) return false;
    if (f.result === 'loss' && !(t.net < 0)) return false;
    if (f.nojournal && t.j) return false;
    if (q && !(`${t.symbol} ${j.setup || ''} ${(j.tags || []).join(' ')} ${(j.mistakes || []).join(' ')} ${j.notes || ''} ${j.emotion || ''}`.toLowerCase().includes(q))) return false;
    return true;
  });
  const sorters = { new: (a, b) => b.close - a.close, old: (a, b) => a.close - b.close, best: (a, b) => b.net - a.net, worst: (a, b) => a.net - b.net, r: (a, b) => (b.r ?? -1e9) - (a.r ?? -1e9) };
  return tr.sort(sorters[f.sort] || sorters.new);
}

function vTrades() {
  const all = scopedTrades();
  const f = S.filters;
  const syms = [...new Set(all.map(t => t.symbol))].sort();
  const tagOpts = [...S.settings.tags, ...S.settings.mistakes];
  const tr = filteredTrades();
  const s = stats(tr);
  const shown = tr.slice(0, S.listLimit);
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`;
  return `
  <div class="filters ${S.showFilters ? 'open' : ''}">
    <input class="inp" type="search" placeholder="Suche: Symbol, Notiz, Setup, Tag …" value="${esc(f.q)}" data-filter="q">
    <button class="btn ftoggle" data-act="ftoggle">Filter${['symbol', 'side', 'setup', 'tag', 'result'].filter(k => f[k]).length + (f.nojournal ? 1 : 0) ? ' · ' + (['symbol', 'side', 'setup', 'tag', 'result'].filter(k => f[k]).length + (f.nojournal ? 1 : 0)) : ''}</button>
    <select data-filter="symbol">${opt('', 'Alle Symbole', f.symbol)}${syms.map(x => opt(x, x, f.symbol)).join('')}</select>
    <select data-filter="side">${opt('', 'Long & Short', f.side)}${opt('long', 'Long', f.side)}${opt('short', 'Short', f.side)}</select>
    <select data-filter="setup">${opt('', 'Alle Setups', f.setup)}${S.settings.setups.map(x => opt(x, x, f.setup)).join('')}</select>
    <select data-filter="tag">${opt('', 'Tags & Fehler', f.tag)}${tagOpts.map(x => opt(x, x, f.tag)).join('')}</select>
    <select data-filter="result">${opt('', 'Gewinn & Verlust', f.result)}${opt('win', 'Nur Gewinner', f.result)}${opt('loss', 'Nur Verlierer', f.result)}</select>
    <select data-filter="sort">${opt('new', 'Neueste zuerst', f.sort)}${opt('old', 'Älteste zuerst', f.sort)}${opt('best', 'Größter Gewinn', f.sort)}${opt('worst', 'Größter Verlust', f.sort)}${opt('r', 'Höchstes R', f.sort)}</select>
    <label class="check"><input type="checkbox" data-filter="nojournal" ${f.nojournal ? 'checked' : ''}> Ohne Journal</label>
    <button class="btn sm" data-act="export">${ic('dl')} CSV</button>
  </div>
  <div class="kpis k4" style="margin-bottom:16px">
    ${kpi('Trades', s.n, `${all.length ? pct(all.filter(t => t.j).length / all.length, 0) : '–'} dokumentiert`)}
    ${kpi('Netto', `<span class="${cls(s.net)}">${money(s.net, true)}</span>`, `Kosten ${money(s.costs)}`)}
    ${kpi('Trefferquote', pct(s.winRate), `PF ${s.pf === Infinity ? '∞' : num(s.pf)}`)}
    ${kpi('Ø R', `<span class="${cls(s.avgR)}">${rFmt(s.avgR)}</span>`, `Ø Haltedauer ${dur(s.avgHold)}`)}
  </div>
  <div class="card">
    ${tr.length ? tradeTable(shown) : `<div class="empty">Keine Trades für diese Filter.</div>`}
    ${tr.length > shown.length ? `<div style="text-align:center;margin-top:14px"><button class="btn" data-act="more">Weitere ${Math.min(60, tr.length - shown.length)} laden · ${tr.length - shown.length} übrig</button></div>` : ''}
  </div>`;
}

function stars(n) { n = n || 0; return n ? `<span class="stars">${'★'.repeat(n)}<span style="color:var(--line2)">${'★'.repeat(5 - n)}</span></span>` : '<span class="dim">–</span>'; }
function tradeTable(list, compactMode = false) {
  const multi = selAccounts().length > 1;
  return `<div class="tblwrap"><table class="tbl trades">
    <thead><tr><th>Geschlossen</th><th>Symbol</th><th>Richtung</th>${multi ? '<th>Konto</th>' : ''}<th class="r">Volumen</th><th class="r">Einstieg</th><th class="r">Ausstieg</th><th class="r">Dauer</th><th>Setup</th><th>Bewertung</th><th class="r">R</th><th class="r">Netto</th></tr></thead>
    <tbody>${list.map(t => {
      const j = t.j || {};
      return `<tr class="click" data-act="trade" data-k="${t.key}">
      <td class="dim">${fDate(t.close)}</td><td class="sym">${esc(t.symbol)}</td>
      <td><span class="badge ${t.dir}">${t.dir === 'long' ? 'Long' : 'Short'}</span></td>
      ${multi ? `<td class="dim">${esc(accName(S.accounts.find(a => a.id === t.account_id) || {}))}</td>` : ''}
      <td class="r num">${num(t.volume)}</td><td class="r num">${price(t.openPrice)}</td><td class="r num">${price(t.closePrice)}</td>
      <td class="r dim">${dur(t.hold)}</td>
      <td>${j.setup ? esc(j.setup) : (t.j ? '<span class="dim">–</span>' : '<span class="badge acc">offen</span>')}${(j.mistakes || []).length ? ` <span class="badge short">${j.mistakes.length} Fehler</span>` : ''}</td>
      <td>${stars(j.rating)}</td>
      <td class="r num ${cls(t.r)}">${rFmt(t.r)}</td><td class="r num ${cls(t.net)}" style="font-weight:600">${money(t.net, true)}</td></tr>`;
    }).join('')}</tbody></table></div>
    <div class="tcards">${list.map(t => {
      const j = t.j || {};
      return `<div class="tcard" data-act="trade" data-k="${t.key}">
        <div class="a"><span class="sym">${esc(t.symbol)}</span><span class="badge ${t.dir}">${t.dir === 'long' ? 'Long' : 'Short'}</span>${j.setup ? `<span class="badge">${esc(j.setup)}</span>` : (t.j ? '' : '<span class="badge acc">Journal offen</span>')}</div>
        <div class="b num ${cls(t.net)}">${money(t.net, true)}</div>
        <div class="c">${fDate(t.close)} · ${num(t.volume)} Lot · ${dur(t.hold)}</div>
        <div class="d num ${cls(t.r)}">${rFmt(t.r)}</div></div>`;
    }).join('')}</div>`;
}

/* ---------------------------------------------------------------------
   Ansicht: Kalender + Tagebuch
   --------------------------------------------------------------------- */
function vCalendar() {
  const now = new Date();
  if (!S.calMonth) S.calMonth = { y: now.getFullYear(), m: now.getMonth() };
  const { y, m } = S.calMonth;
  const tr = scopedTrades(true);
  const byDay = {};
  for (const t of tr) { const k = dayKey(t.close); (byDay[k] = byDay[k] || []).push(t); }
  const first = new Date(y, m, 1), startOff = (first.getDay() + 6) % 7;
  const gridStart = new Date(y, m, 1 - startOff);
  const todayK = dayKey(Date.now());
  const mAbs = monthMaxAbs(byDay, y, m) || 1;
  let cells = '', monthNet = 0, monthN = 0, wd = 0, ld = 0;
  for (let w = 0; w < 6; w++) {
    let wkNet = 0, wkN = 0, any = false;
    for (let d = 0; d < 7; d++) {
      const dt = new Date(gridStart); dt.setDate(gridStart.getDate() + w * 7 + d);
      const k = dayKey(dt), inM = dt.getMonth() === m;
      if (inM) any = true;
      const list = byDay[k] || [];
      const net = list.reduce((s, t) => s + t.net, 0);
      if (inM && list.length) { monthNet += net; monthN += list.length; if (net > 0) wd++; else if (net < 0) ld++; wkNet += net; wkN += list.length; }
      const bg = list.length && inM ? `background:linear-gradient(0deg, ${net >= 0 ? 'rgba(31,199,126,' : 'rgba(242,84,91,'}${Math.min(0.32, 0.08 + Math.abs(net) / mAbs * 0.24).toFixed(3)}), transparent 120%)` : '';
      cells += `<button class="cell ${inM ? '' : 'out'} ${k === S.selDay ? 'sel' : ''} ${k === todayK ? 'today' : ''}" ${inM ? `data-act="day" data-d="${k}"` : 'disabled'} style="${bg}">
        <span class="dn">${dt.getDate()}</span>${S.daily[k] && inM ? '<span class="jn"></span>' : ''}
        ${list.length && inM ? `<span class="pl num ${cls(net)}"><span class="full">${compact(net)}</span></span><span class="tc">${list.length} Trade${list.length > 1 ? 's' : ''}</span>` : ''}</button>`;
    }
    cells += `<div class="cell wk wkc">${wkN ? `<span class="dn">Woche</span><span class="pl num ${cls(wkNet)}">${money(wkNet, true)}</span><span class="tc">${wkN} Trades</span>` : ''}</div>`;
    if (!any) break;
  }
  return `
  <div class="row" style="margin-bottom:14px">
    <button class="btn sm" data-act="cal" data-v="-1" aria-label="Vorheriger Monat">${ic('left')}</button>
    <div style="font-size:17px;font-weight:650;min-width:150px;text-align:center">${MONTHS[m]} ${y}</div>
    <button class="btn sm" data-act="cal" data-v="1" aria-label="Nächster Monat">${ic('right')}</button>
    <button class="btn sm ghost" data-act="cal" data-v="0">Heute</button>
    <span style="flex:1"></span>
    <span class="badge">${monthN} Trades</span><span class="badge long">${wd} Gewinntage</span><span class="badge short">${ld} Verlusttage</span>
    <span class="num ${cls(monthNet)}" style="font-weight:650;font-size:16px">${money(monthNet, true)}</span>
  </div>
  <div class="cal">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => `<div class="h">${d}</div>`).join('')}<div class="h wkc">Woche</div>${cells}</div>
  <div id="daypanel" style="margin-top:18px">${S.selDay ? dayPanel(S.selDay, byDay[S.selDay] || []) : `<div class="hint">Tippe auf einen Tag, um Trades zu sehen und dein Tagebuch zu schreiben (Vorbereitung, Rückblick, Lektionen).</div>`}</div>`;
}
function monthMaxAbs(byDay, y, m) {
  let mx = 0; const pre = `${y}-${pad(m + 1)}-`;
  for (const [k, list] of Object.entries(byDay)) if (k.startsWith(pre)) mx = Math.max(mx, Math.abs(list.reduce((s, t) => s + t.net, 0)));
  return mx;
}

function dayPanel(k, list) {
  const d = S.daily[k] || {};
  const net = list.reduce((s, t) => s + t.net, 0);
  const dt = new Date(k + 'T12:00:00');
  const moods = ['😣', '😕', '😐', '🙂', '😄'];
  return `<div class="grid g2">
    <div class="card"><h3>${WD[dt.getDay()]}, ${fDate(dt.getTime(), false)}<span class="sp"></span><span class="num ${cls(net)}" style="font-size:15px">${list.length ? money(net, true) : ''}</span></h3>
      ${list.length ? tradeTable(list.slice().sort((a, b) => a.close - b.close)) : '<div class="empty" style="padding:16px">Keine Trades an diesem Tag.</div>'}</div>
    <div class="card form" data-form="daily"><h3>${ic('book')} Tagebuch</h3>
      <div class="field"><label>Verfassung</label><div class="chips">${moods.map((e, i) => `<button class="chip ${d.mood === i + 1 ? 'on' : ''}" data-act="mood" data-v="${i + 1}" style="font-size:18px;padding:3px 10px">${e}</button>`).join('')}</div></div>
      <div class="field"><label>Vorbereitung &amp; Plan</label><textarea data-d="plan" placeholder="Marktbild, Key-Levels, News, maximale Trades …">${esc(d.plan)}</textarea></div>
      <div class="field"><label>Rückblick</label><textarea data-d="review" placeholder="Was lief gut, was nicht?">${esc(d.review)}</textarea></div>
      <div class="field"><label>Lektionen</label><textarea data-d="lessons" placeholder="Eine Sache, die ich morgen besser mache …" style="min-height:70px">${esc(d.lessons)}</textarea></div>
      <div class="row" style="justify-content:flex-end"><button class="btn pri" data-act="save-daily" data-d="${k}">${ic('check')} Speichern</button></div>
    </div></div>`;
}

/* ---------------------------------------------------------------------
   Ansicht: Statistik
   --------------------------------------------------------------------- */
function vStats() {
  const tr = scopedTrades();
  if (!tr.length) return `<div class="card empty">Noch keine abgeschlossenen Trades im gewählten Zeitraum.</div>`;
  const s = stats(tr), eqs = equitySeries();
  const withMfe = tr.filter(t => t.net > 0 && t.mfe > 0);
  const eff = withMfe.length ? withMfe.reduce((a, t) => a + Math.min(1, t.net / t.mfe), 0) / withMfe.length : null;
  const maeW = tr.filter(t => t.net > 0 && t.risk && t.mae != null);
  const maeR = maeW.length ? maeW.reduce((a, t) => a + t.mae / t.risk, 0) / maeW.length : null;
  const journaled = tr.filter(t => t.j).length;
  const grp = (title, rows, label = 'Gruppe') => `<div class="card"><h3>${title}</h3>${rows.length ? `<div class="tblwrap"><table class="tbl"><thead><tr><th>${label}</th><th class="r">Trades</th><th>Trefferquote</th><th class="r">PF</th><th class="r">Ø R</th><th class="r">Netto</th></tr></thead><tbody>${rows.map(({ k, s }) => `<tr><td style="font-weight:550">${esc(k)}</td><td class="r num">${s.n}</td><td><div class="wbar"><i><b style="width:${(s.winRate || 0) * 100}%"></b></i><span class="num">${pct(s.winRate, 0)}</span></div></td><td class="r num">${s.pf === Infinity ? '∞' : num(s.pf)}</td><td class="r num ${cls(s.avgR)}">${rFmt(s.avgR)}</td><td class="r num ${cls(s.net)}" style="font-weight:600">${money(s.net, true)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty" style="padding:14px">Noch keine Journal-Daten.</div>'}</div>`;
  const jt = tr.filter(t => t.j);
  return `
  <div class="kpis">
    ${kpi('Netto-P/L', `<span class="${cls(s.net)}">${money(s.net, true)}</span>`, `Brutto ${money(s.net - s.costs, true)}`)}
    ${kpi('Trades', s.n, `${pct(journaled / s.n, 0)} dokumentiert`)}
    ${kpi('Trefferquote', pct(s.winRate), `${s.wins} / ${s.losses}`)}
    ${kpi('Profit-Faktor', s.pf === Infinity ? '∞' : num(s.pf), `Payoff-Ratio ${num(s.payoff)}`)}
    ${kpi('Erwartungswert', `<span class="${cls(s.exp)}">${money(s.exp, true)}</span>`, `${rFmt(s.avgR)} pro Trade`)}
    ${kpi('Max. Drawdown', `<span class="neg">${pct(-eqs.maxDD, 2)}</span>`, money(-eqs.maxDDAbs))}
    ${kpi('Ø Gewinn', `<span class="pos">${money(s.avgWin)}</span>`, `Bester ${money(s.best && s.best.net)}`)}
    ${kpi('Ø Verlust', `<span class="neg">${money(s.avgLoss)}</span>`, `Schlechtester ${money(s.worst && s.worst.net)}`)}
    ${kpi('Serien', `<span class="pos">${s.wStreak}</span> / <span class="neg">${s.lStreak}</span>`, 'längste Gewinn- / Verlustserie')}
    ${kpi('Ø Haltedauer', dur(s.avgHold), `Gewinner ${dur(stats(tr.filter(t => t.net > 0)).avgHold)}`)}
    ${kpi('Ausstiegs-Effizienz', pct(eff, 0), 'realisiert vom max. Buchgewinn')}
    ${kpi('Ø MAE Gewinner', rFmt(maeR), 'wie weit Gewinner gegen dich liefen')}
  </div>
  <div class="grid g3" style="margin-top:16px">
    <div class="card"><h3>R-Verteilung</h3><div class="chartbox sm"><canvas id="c-r"></canvas></div></div>
    <div class="card"><h3>P/L nach Wochentag</h3><div class="chartbox sm"><canvas id="c-wd"></canvas></div></div>
    <div class="card"><h3>P/L nach Uhrzeit (Einstieg)</h3><div class="chartbox sm"><canvas id="c-hr"></canvas></div></div>
  </div>
  <div class="sect">Was funktioniert</div>
  <div class="grid g2">
    ${grp('Nach Symbol', groupBy(tr, t => t.symbol), 'Symbol')}
    ${grp('Nach Setup', groupBy(jt, t => t.j.setup), 'Setup')}
    ${grp('Nach Session (UTC)', groupBy(tr, session), 'Session')}
    ${grp('Long vs. Short', groupBy(tr, t => t.dir === 'long' ? 'Long' : 'Short'), 'Richtung')}
  </div>
  <div class="sect">Psychologie &amp; Disziplin</div>
  <div class="grid g2">
    ${grp('Kosten deiner Fehler', groupBy(jt, t => t.j.mistakes && t.j.mistakes.length ? t.j.mistakes : 'Kein Fehler'), 'Fehler')}
    ${grp('Nach Emotion', groupBy(jt, t => t.j.emotion), 'Emotion')}
    ${grp('Plan befolgt?', groupBy(jt.filter(t => t.j.plan_followed != null), t => t.j.plan_followed ? 'Ja' : 'Nein'), 'Plan')}
    ${grp('Nach eigener Bewertung', groupBy(jt.filter(t => t.j.rating), t => '★'.repeat(t.j.rating)), 'Bewertung')}
    ${grp('Nach Tags', groupBy(jt, t => t.j.tags || []), 'Tag')}
    <div class="card"><h3>MAE vs. Ergebnis (in R)</h3><div class="chartbox"><canvas id="c-mae"></canvas></div><div class="dim" style="font-size:12px;margin-top:8px">Liegen viele Gewinner nahe −1R, ist dein Stop eng gesetzt; enden Verlierer selten unter −1R, hältst du deine Stops ein.</div></div>
  </div>`;
}

/* ---------------------------------------------------------------------
   Ansicht: Einstellungen
   --------------------------------------------------------------------- */
function vSettings() {
  const url = DS === Live ? (CFG.supabaseUrl || LS.get('sbUrl', '')) : 'https://DEIN-PROJEKT.supabase.co';
  const key = DS === Live ? (CFG.supabaseKey || LS.get('sbKey', '')) : 'DEIN_ANON_KEY';
  const lists = [['setups', 'Setups'], ['tags', 'Tags'], ['mistakes', 'Fehler-Katalog'], ['emotions', 'Emotionen']];
  return `
  <div class="grid g2">
    <div class="card"><h3>${ic('bolt')} MetaTrader 5 verbinden</h3>
      <p class="muted" style="margin:0 0 14px">Im Expert Advisor <b>TradingJournalSync</b> diese drei Werte eintragen. Jeder Token kann jederzeit widerrufen werden.</p>
      <div class="kv" style="margin-bottom:14px">
        <span class="k dim">InpSupabaseUrl</span><code>${esc(url)}</code><button class="btn sm" data-act="copy" data-v="${esc(url)}">${ic('copy')}</button>
        <span class="k dim">InpApiKey</span><code>${esc(key)}</code><button class="btn sm" data-act="copy" data-v="${esc(key)}">${ic('copy')}</button>
      </div>
      <div class="field"><label>Sync-Tokens (InpSyncToken)</label>
      ${S.tokens.length ? `<table class="tbl"><tbody>${S.tokens.map(t => `<tr><td><b>${esc(t.label || 'Token')}</b><div class="dim num" style="font-size:11.5px">${esc(t.token.slice(0, 6))}…${esc(t.token.slice(-4))}</div></td><td class="dim" style="font-size:12px">zuletzt aktiv<br>${t.last_used_at ? ago(Date.parse(t.last_used_at)) : 'nie'}</td><td class="r"><button class="btn sm" data-act="copy" data-v="${esc(t.token)}">${ic('copy')}</button> <button class="btn sm danger" data-act="token-del" data-v="${esc(t.token)}">${ic('x')}</button></td></tr>`).join('')}</tbody></table>` : '<div class="dim" style="font-size:13px">Noch kein Token erstellt.</div>'}
      </div>
      <div class="row"><input class="inp" id="tok-label" placeholder="Name, z. B. MT5 Laptop" style="flex:1"><button class="btn pri" data-act="token-new">${ic('plus')} Token erstellen</button></div>
      <div class="hint" style="margin-top:14px">MT5: <b>Extras → Optionen → Expert Advisors</b> → „WebRequest für folgende URLs erlauben“ aktivieren und <b>${esc(url)}</b> eintragen. Den EA auf einen beliebigen Chart ziehen – er synchronisiert alle Trades des Kontos.</div>
    </div>
    <div class="card"><h3>${ic('wallet')} Konten</h3>
      <p class="muted" style="margin:0 0 12px">${S.accounts.length} MT5-Konto${S.accounts.length === 1 ? '' : 'en'} verbunden. Kontotyp (FundedNext, andere Prop-Firm, privat), Programm/Phase, Regeln und Status verwaltest du unter <b>Konten</b>.</p>
      <a class="btn" href="#konten">${ic('wallet')} Zu den Konten</a>
      <h3 style="margin-top:22px">Konto &amp; App</h3>
      <div class="row" style="margin-bottom:10px"><span class="muted">Angemeldet als</span><b>${esc(S.user && S.user.email)}</b></div>
      <div class="row"><button class="btn" data-act="export">${ic('dl')} Alle Trades als CSV</button><button class="btn" data-act="reload">Daten neu laden</button><button class="btn danger" data-act="logout">${ic('out')} ${S.mode === 'demo' ? 'Demo beenden' : 'Abmelden'}</button></div>
      <h3 style="margin-top:22px">${ic('img')} Speicher</h3>
      <div id="usage" class="meters sm"><div class="dim" style="font-size:13px">Wird geladen …</div></div>
      <div class="hint" style="margin-top:14px"><b>Auf dem iPhone installieren:</b> Seite in Safari öffnen → Teilen-Symbol → „Zum Home-Bildschirm“. <b>Auf dem Mac:</b> in Safari „Ablage → Zum Dock hinzufügen“ oder in Chrome „Installieren“.</div>
    </div>
  </div>
  <div class="sect">Journal-Vorlagen</div>
  <div class="grid g2">${lists.map(([k, l]) => `<div class="card"><h3>${l}</h3><div class="chips" style="margin-bottom:12px">${S.settings[k].map(x => `<span class="chip">${esc(x)}<button class="x" style="background:none;border:0;color:inherit;padding:0" data-act="list-del" data-l="${k}" data-v="${esc(x)}" aria-label="entfernen">✕</button></span>`).join('')}</div>
    <div class="row"><input class="inp" style="flex:1" placeholder="Neu hinzufügen …" data-listinp="${k}"><button class="btn sm" data-act="list-add" data-l="${k}">${ic('plus')}</button></div></div>`).join('')}</div>`;
}

/* ---------------------------------------------------------------------
   Konten, Kontotypen & Prop-Firm-Regeln
   --------------------------------------------------------------------- */
// Voreinstellungen FundedNext (CFD / Stellar). Werte in % der Anfangsbilanz.
// Jederzeit pro Konto überschreibbar – bitte mit dem FundedNext-Dashboard abgleichen.
const FN_PRESETS = {
  'fn-2step-p1': { label: 'Stellar 2-Step · Phase 1', target: 8, daily: 5, max: 10, maxType: 'static', minDays: 5 },
  'fn-2step-p2': { label: 'Stellar 2-Step · Phase 2', target: 5, daily: 5, max: 10, maxType: 'static', minDays: 5 },
  'fn-2step-f': { label: 'Stellar 2-Step · FundedNext Account', target: 0, daily: 5, max: 10, maxType: 'static', minDays: 0 },
  'fn-1step-p1': { label: 'Stellar 1-Step · Challenge', target: 10, daily: 3, max: 6, maxType: 'static', minDays: 2 },
  'fn-1step-f': { label: 'Stellar 1-Step · FundedNext Account', target: 0, daily: 3, max: 6, maxType: 'static', minDays: 0 },
  'fn-lite-p1': { label: 'Stellar Lite · Phase 1', target: 8, daily: 4, max: 8, maxType: 'static', minDays: 5 },
  'fn-lite-p2': { label: 'Stellar Lite · Phase 2', target: 4, daily: 4, max: 8, maxType: 'static', minDays: 5 },
  'fn-lite-f': { label: 'Stellar Lite · FundedNext Account', target: 0, daily: 4, max: 8, maxType: 'static', minDays: 0 },
  'fn-instant': { label: 'Stellar Instant', target: 0, daily: 0, max: 6, maxType: 'trailing', minDays: 0 }
};
const ACC_TYPES = [['fundednext', 'FundedNext'], ['prop', 'Andere Prop-Firm'], ['private', 'Privat- / Brokerkonto']];
const ACC_STATUS = [['aktiv', 'Aktiv'], ['bestanden', 'Bestanden'], ['nicht-bestanden', 'Nicht bestanden'], ['archiviert', 'Archiviert']];
const statusLabel = s => (ACC_STATUS.find(x => x[0] === s) || ACC_STATUS[0])[1];

function acctType(a) {
  const p = a.prop || {};
  if (p.type) return p.type;
  return /fundednext/i.test(`${a.server || ''} ${a.broker || ''}`) ? 'fundednext' : 'private';
}
const acctStatus = a => (a.prop && a.prop.status) || 'aktiv';
function initialBalance(a, ignoreSetting = false) {
  const p = a.prop || {};
  if (!ignoreSetting && +p.size > 0) return +p.size;
  const dep = S.deals.find(d => d.account_id === a.id && d.type > 1 && d.profit > 0);
  if (dep) return dep.profit;
  const st = S.states[a.id];
  return st ? +st.balance : null;
}
function acctRules(a) {
  const t = acctType(a);
  if (t === 'private') return null;
  const p = a.prop || {};
  const pre = t === 'fundednext' ? (FN_PRESETS[p.preset] || {}) : {};
  const pickN = k => (p[k] !== undefined && p[k] !== null && p[k] !== '') ? +p[k] : (pre[k] ?? null);
  return {
    type: t, preset: p.preset || null,
    firm: t === 'fundednext' ? 'FundedNext' : (p.firm || 'Prop-Firm'),
    label: t === 'fundednext' ? (pre.label || null) : (p.program || null),
    size: initialBalance(a), target: pickN('target'), daily: pickN('daily'), max: pickN('max'),
    maxType: p.maxType || pre.maxType || 'static', minDays: pickN('minDays'), status: acctStatus(a)
  };
}
const srvOff = a => ((a.server_offset ?? 7200) * 1000);
const srvDayStart = (a, t = Date.now()) => Math.floor((t + srvOff(a)) / 864e5) * 864e5 - srvOff(a);
const srvDayKey = (a, t) => new Date(t + srvOff(a)).toISOString().slice(0, 10);

// Kennzahlen gegen die Regeln – FundedNext-Logik:
// Tagesverlust = (Equity jetzt) − (Balance um 00:00 Serverzeit), Limit = % der Anfangsbilanz.
function propState(a) {
  const R = acctRules(a);
  if (!R) return null;
  if (!R.size) return { R, missing: true };
  const st = S.states[a.id];
  const d0 = srvDayStart(a);
  let bal = 0, peak = -Infinity, today = 0;
  const days = new Set(), dayPL = {};
  for (const d of S.deals) {
    if (d.account_id !== a.id) continue;
    const v = d.profit + d.commission + d.swap + d.fee;
    bal += v; peak = Math.max(peak, bal);
    if (d.type <= 1) {
      const k = srvDayKey(a, d.t);
      dayPL[k] = (dayPL[k] || 0) + v;
      if (d.entry === 0) days.add(k);
      if (d.t >= d0) today += v;
    }
  }
  const balance = st ? +st.balance : bal;
  const equity = st ? +st.equity : balance;
  const o = { R, balance, equity, updated: st ? st.updated : null, fresh: !!(st && Date.now() - st.updated < 90e3) };
  o.pnl = balance - R.size; o.pnlPct = o.pnl / R.size;
  if (R.target > 0) { o.targetAmt = R.size * R.target / 100; o.targetProg = Math.max(0, o.pnl) / o.targetAmt; }
  if (R.daily > 0) {
    o.dailyAmt = R.size * R.daily / 100;
    o.dayStartBal = balance - today;
    o.dayResult = equity - o.dayStartBal;
    o.dailyFloor = o.dayStartBal - o.dailyAmt;
    o.dailyLeft = equity - o.dailyFloor;
    o.dailyUsed = Math.max(0, -o.dayResult) / o.dailyAmt;
    const worst = Math.min(0, ...Object.values(dayPL));
    o.worstDay = worst; o.worstDayUsed = -worst / o.dailyAmt;
  }
  if (R.max > 0) {
    o.maxAmt = R.size * R.max / 100;
    o.maxFloor = R.maxType === 'trailing' ? Math.min(R.size, Math.max(peak, equity, R.size) - o.maxAmt) : R.size - o.maxAmt;
    o.maxLeft = equity - o.maxFloor;
    o.maxUsed = Math.max(0, Math.min(1, 1 - o.maxLeft / o.maxAmt));
  }
  o.days = days.size; o.minDays = R.minDays || 0;
  o.targetHit = o.targetAmt != null && o.pnl >= o.targetAmt;
  o.breach = (o.dailyLeft != null && o.dailyLeft < 0) || (o.maxLeft != null && o.maxLeft < 0);
  return o;
}

function meter(label, value, ratio, sub, good) {
  const r = Math.max(0, Math.min(1, ratio || 0));
  const col = good ? 'var(--pos)' : r >= 0.85 ? 'var(--neg)' : r >= 0.6 ? 'var(--warn)' : 'var(--acc)';
  return `<div class="meter"><div class="mt"><span>${label}</span><span class="num">${value}</span></div><div class="bar"><i style="width:${(r * 100).toFixed(1)}%;background:${col}"></i></div><div class="ms">${sub}</div></div>`;
}
const accBadge = a => {
  const t = acctType(a), R = acctRules(a), s = acctStatus(a);
  const sc = { aktiv: 'acc', bestanden: 'long', 'nicht-bestanden': 'short', archiviert: '' }[s];
  return `${t === 'private' ? '<span class="badge">Privat</span>' : `<span class="badge">${esc(R.firm)}</span>`}${R && R.label ? `<span class="badge">${esc(R.label)}</span>` : ''}<span class="badge ${sc}">${statusLabel(s)}</span>`;
};

function ruleCard(a) {
  const o = propState(a);
  if (!o) return '';
  const R = o.R;
  const head = `<h3><span style="color:var(--tx);font-size:14px">${esc(accName(a))}</span><span class="sp"></span><span class="row" style="gap:6px">${accBadge(a)}</span></h3>`;
  if (o.missing) return `<div class="card">${head}<div class="hint">Anfangsbilanz unbekannt – unter <a href="#konten">Konten</a> die Kontogröße eintragen.</div></div>`;
  const alerts = [];
  if (R.type === 'fundednext' && !R.preset) alerts.push(`<div class="alert">${ic('gear')} Programm noch nicht gewählt – unter <a href="#konten">Konten</a> festlegen (z. B. Stellar 2-Step · Phase 1).</div>`);
  if (o.breach) alerts.push(`<div class="alert bad">${ic('bolt')} Laut Journal-Berechnung ist ein Limit überschritten – bitte im ${esc(R.firm)}-Dashboard prüfen.</div>`);
  else if (o.dailyLeft != null && o.dailyLeft < o.dailyAmt * 0.25) alerts.push(`<div class="alert warn">${ic('bolt')} Nur noch <b>${money(o.dailyLeft)}</b> bis zum Tageslimit.</div>`);
  if (o.targetHit && !o.breach) alerts.push(o.days >= o.minDays ? `<div class="alert ok">${ic('check')} Profitziel erreicht${o.minDays ? ' und Mindest-Handelstage erfüllt' : ''}.</div>` : `<div class="alert ok">${ic('check')} Profitziel erreicht – noch ${o.minDays - o.days} Handelstag${o.minDays - o.days > 1 ? 'e' : ''} nötig.</div>`);
  const m = [];
  if (o.targetAmt) m.push(meter('Profitziel', `${money(o.pnl, true)} / ${money(o.targetAmt)}`, o.targetProg, `${pct(o.targetProg, 0)} erreicht · Ziel ${num(R.target, 0)} %`, true));
  else m.push(meter('Gewinn seit Start', `<span class="${cls(o.pnl)}">${money(o.pnl, true)}</span>`, 0, `${pct(o.pnlPct, 2)} auf ${money(R.size)}`, true));
  if (o.dailyAmt) m.push(meter('Tagesverlust heute', `${money(Math.min(0, o.dayResult))} / −${money(o.dailyAmt)}`, o.dailyUsed, `noch <b>${money(Math.max(0, o.dailyLeft))}</b> · Equity-Untergrenze ${money(o.dailyFloor)}`));
  if (o.maxAmt) m.push(meter(`Max-Verlust${R.maxType === 'trailing' ? ' (trailing)' : ''}`, `Puffer ${money(Math.max(0, o.maxLeft))}`, o.maxUsed, `Untergrenze ${money(o.maxFloor)} · ${num(R.max, 0)} %`));
  if (o.minDays) m.push(meter('Handelstage', `${o.days} / ${o.minDays}`, o.days / o.minDays, o.days >= o.minDays ? 'erfüllt' : `noch ${o.minDays - o.days}`, true));
  const foot = `<div class="dim" style="font-size:11.5px;margin-top:10px">Equity ${money(o.equity)} · ${o.fresh ? 'live' : o.updated ? 'Stand ' + ago(o.updated) : 'keine Live-Daten'}${o.worstDay != null ? ` · schlechtester Tag (realisiert) ${money(o.worstDay)}` : ''}</div>`;
  return `<div class="card">${head}${alerts.join('')}<div class="meters">${m.join('')}</div>${foot}</div>`;
}

function ruleMonitor(accs) {
  const list = accs.filter(a => acctRules(a) && acctStatus(a) === 'aktiv');
  if (!list.length) return '';
  return `<div class="sect" style="margin-top:4px">Regel-Monitor</div><div class="grid ${list.length > 1 ? 'g2' : ''}" style="margin-bottom:16px">${list.map(ruleCard).join('')}</div>`;
}

/* Ansicht: Konten */
function vAccounts() {
  if (!S.accounts.length) return onboardingCard();
  const order = { aktiv: 0, bestanden: 1, 'nicht-bestanden': 2, archiviert: 3 };
  const out = [];
  for (const [t, title] of ACC_TYPES) {
    const list = S.accounts.filter(a => acctType(a) === t).sort((x, y) => (order[acctStatus(x)] - order[acctStatus(y)]) || (y.id - x.id));
    if (!list.length) continue;
    out.push(`<div class="sect">${title} <span class="badge" style="margin-left:6px">${list.length}</span></div><div class="grid g2">${list.map(accCard).join('')}</div>`);
  }
  return `<div class="hint" style="margin-bottom:6px">Neue MT5-Konten erscheinen hier automatisch, sobald der EA sie überträgt – auch wenn du in MT5 zwischen Konten wechselst. FundedNext-Konten werden am Server erkannt; Regeln und Status legst du mit <b>Bearbeiten</b> fest.</div>${out.join('')}`;
}
function accCard(a) {
  const st = S.states[a.id];
  const tr = S.trades.filter(t => t.account_id === a.id);
  const s = stats(tr);
  const o = propState(a);
  const fresh = st && Date.now() - st.updated < 90e3;
  const meters = [];
  if (o && !o.missing && acctStatus(a) === 'aktiv') {
    if (o.targetAmt) meters.push(meter('Profitziel', pct(o.targetProg, 0), o.targetProg, `${money(o.pnl, true)} von ${money(o.targetAmt)}`, true));
    if (o.dailyAmt) meters.push(meter('Tageslimit', `noch ${money(Math.max(0, o.dailyLeft))}`, o.dailyUsed, ''));
    if (o.maxAmt) meters.push(meter('Max-Verlust', `Puffer ${money(Math.max(0, o.maxLeft))}`, o.maxUsed, ''));
  }
  const pnl = o && !o.missing ? o.pnl : s.net;
  return `<div class="card acard ${acctStatus(a) !== 'aktiv' ? 'inactive' : ''}">
    <div class="row" style="justify-content:space-between;align-items:flex-start;margin-bottom:10px"><div><div style="font-weight:650;font-size:15px">${esc(accName(a))}</div>
      <div class="dim" style="font-size:12px;margin-top:2px">${a.login} · ${esc(a.server)}${a.is_demo ? ' · Demo' : ''}</div></div>
      <span class="dot ${fresh ? 'live' : st ? 'warn' : 'off'}" title="${st ? 'Stand ' + ago(st.updated) : 'keine Live-Daten'}" style="margin-top:6px"></span></div>
    <div class="row" style="gap:6px;margin-bottom:12px">${accBadge(a)}</div>
    <div class="facts" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:12px">
      <div><div class="l">Balance</div><div class="v num">${st ? money(st.balance, false, a.currency) : '–'}</div></div>
      <div><div class="l">${o && !o.missing ? 'Seit Start' : 'Netto'}</div><div class="v num ${cls(pnl)}">${money(pnl, true, a.currency)}</div></div>
      <div><div class="l">Trades</div><div class="v num">${s.n} · ${pct(s.winRate, 0)}</div></div>
    </div>
    ${meters.length ? `<div class="meters sm">${meters.join('')}</div>` : ''}
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn sm" data-act="edit-acc" data-v="${a.id}">${ic('gear')} Bearbeiten</button><button class="btn sm pri" data-act="pick-acc" data-v="${a.id}">Öffnen ${ic('right')}</button></div>
  </div>`;
}

/* Konto bearbeiten (Modal) */
function openAccount(id) {
  const a = S.accounts.find(x => String(x.id) === String(id)); if (!a) return;
  const p = a.prop || {};
  const v = k => p[k] === undefined || p[k] === null ? '' : p[k];
  S.modal = null;
  S.amodal = { id: a.id, busy: false, d: { label: a.label || '', type: acctType(a), preset: p.preset || '', firm: p.firm || '', program: p.program || '', size: v('size'), target: v('target'), daily: v('daily'), max: v('max'), maxType: p.maxType || '', minDays: v('minDays'), status: acctStatus(a) } };
  renderAcctModal();
}
function renderAcctModal() {
  const M = S.amodal; if (!M) return;
  const a = S.accounts.find(x => x.id === M.id); const D = M.d;
  const pre = D.type === 'fundednext' ? (FN_PRESETS[D.preset] || {}) : {};
  const ph = k => pre[k] === undefined ? '' : pre[k] === 0 ? (k === 'minDays' ? 'Standard: keine' : 'Standard: keins') : `Standard: ${pre[k]}`;
  const autoSize = initialBalance(a, true);
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`;
  const rules = D.type === 'private' ? `<div class="hint">Privat- und Brokerkonten haben keine Prop-Regeln. Alle Statistiken, das Journal und der Kalender funktionieren wie gewohnt.</div>` : `
    ${D.type === 'fundednext' ? `<div class="field"><label>Programm / Phase</label><select data-am="preset" style="width:100%">${opt('', '– bitte wählen –', D.preset)}${Object.entries(FN_PRESETS).map(([k, x]) => opt(k, x.label, D.preset)).join('')}</select></div>` :
      `<div class="grid g2" style="gap:12px"><div class="field"><label>Prop-Firm</label><input class="inp" style="width:100%" data-am="firm" value="${esc(D.firm)}" placeholder="z. B. FTMO"></div><div class="field"><label>Programm / Phase</label><input class="inp" style="width:100%" data-am="program" value="${esc(D.program)}" placeholder="z. B. Challenge Phase 1"></div></div>`}
    <div class="grid g2" style="gap:12px">
      <div class="field"><label>Kontogröße / Anfangsbilanz</label><input class="inp" style="width:100%" type="number" inputmode="decimal" data-am="size" value="${esc(D.size)}" placeholder="${autoSize ? 'automatisch: ' + num(autoSize, 0) : 'z. B. 100000'}"></div>
      <div class="field"><label>Profitziel %</label><input class="inp" style="width:100%" type="number" inputmode="decimal" step="0.1" data-am="target" value="${esc(D.target)}" placeholder="${ph('target') || '0 = kein Ziel'}"></div>
      <div class="field"><label>Tagesverlust-Limit %</label><input class="inp" style="width:100%" type="number" inputmode="decimal" step="0.1" data-am="daily" value="${esc(D.daily)}" placeholder="${ph('daily') || '0 = keins'}"></div>
      <div class="field"><label>Max-Verlust %</label><input class="inp" style="width:100%" type="number" inputmode="decimal" step="0.1" data-am="max" value="${esc(D.max)}" placeholder="${ph('max') || '0 = keins'}"></div>
      <div class="field"><label>Max-Verlust-Art</label><select data-am="maxType" style="width:100%">${opt('', pre.maxType ? `Standard (${pre.maxType === 'trailing' ? 'trailing' : 'statisch'})` : 'Statisch', D.maxType)}${opt('static', 'Statisch (fest ab Anfangsbilanz)', D.maxType)}${opt('trailing', 'Trailing (folgt dem Höchststand)', D.maxType)}</select></div>
      <div class="field"><label>Mindest-Handelstage</label><input class="inp" style="width:100%" type="number" inputmode="numeric" data-am="minDays" value="${esc(D.minDays)}" placeholder="${ph('minDays') || '0'}"></div>
    </div>
    <div class="hint">Leere Felder übernehmen die Standardwerte des Programms. Tagesverlust wird wie bei FundedNext berechnet: Equity gegen die Balance um 00:00 Serverzeit, Limit in % der Anfangsbilanz – offene Positionen, Kommission und Swap zählen mit. Werte bitte mit deinem Dashboard abgleichen.</div>`;
  $('#modal').innerHTML = `
  <div class="ov" data-act="ov"><div class="sheet" role="dialog" aria-modal="true">
    <div class="hd"><h2>Konto bearbeiten</h2><button class="btn ghost sm" data-act="close" aria-label="Schließen">${ic('x')}</button></div>
    <div class="bd">
      <div class="dim" style="margin-bottom:16px">${a.login} · ${esc(a.server)} · ${esc(a.broker || '')}</div>
      <div class="field"><label>Name im Journal</label><input class="inp" style="width:100%" data-am="label" value="${esc(D.label)}" placeholder="${esc(`${a.broker || a.server} · ${a.login}`)}"></div>
      <div class="grid g2" style="gap:12px">
        <div class="field"><label>Kontotyp</label><select data-am="type" style="width:100%">${ACC_TYPES.map(([k, l]) => opt(k, l, D.type)).join('')}</select></div>
        <div class="field"><label>Status</label><select data-am="status" style="width:100%">${ACC_STATUS.map(([k, l]) => opt(k, l, D.status)).join('')}</select></div>
      </div>
      ${rules}
    </div>
    <div class="ft"><button class="btn ghost" data-act="close">Abbrechen</button><button class="btn pri" data-act="save-acc" ${M.busy ? 'disabled' : ''}>${ic('check')} Speichern</button></div>
  </div></div>`;
  document.body.style.overflow = 'hidden';
}
async function saveAccount() {
  const M = S.amodal; if (!M) return;
  const D = M.d, n = v => v === '' || v == null || !isFinite(+v) ? null : +v;
  const prop = { type: D.type, status: D.status };
  if (D.type === 'fundednext') prop.preset = D.preset || null;
  if (D.type === 'prop') { prop.firm = D.firm.trim() || null; prop.program = D.program.trim() || null; }
  if (D.type !== 'private') Object.assign(prop, { size: n(D.size), target: n(D.target), daily: n(D.daily), max: n(D.max), maxType: D.maxType || null, minDays: n(D.minDays) });
  const patch = { label: D.label.trim() || null, prop };
  M.busy = true; renderAcctModal();
  try {
    await DS.saveAccount(M.id, patch);
    const a = S.accounts.find(x => x.id === M.id); Object.assign(a, patch);
    closeModal(); toast(`${ic('check')} Konto gespeichert`); render();
  } catch (e) { M.busy = false; renderAcctModal(); toast('Fehler: ' + esc(e.message || e)); }
}

/* ---------------------------------------------------------------------
   Charts
   --------------------------------------------------------------------- */
const C = { pos: '#1fc77e', neg: '#f2545b', acc: '#5b8cff', grid: 'rgba(255,255,255,.05)', tx: '#8794a8' };
function chartDefaults() {
  if (!window.Chart) return;
  Chart.defaults.color = C.tx;
  Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  Chart.defaults.font.size = 11;
  Chart.defaults.plugins.legend.display = false;
  Chart.defaults.plugins.tooltip.backgroundColor = '#1a2230';
  Chart.defaults.plugins.tooltip.borderColor = '#283244';
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.displayColors = false;
  Chart.defaults.animation = false;
  Chart.defaults.maintainAspectRatio = false;
}
function mk(id, cfg) {
  const el = document.getElementById(id);
  if (!el || !window.Chart) return;
  charts.push(new Chart(el, cfg));
}
const axes = (yFmt = v => compact(v)) => ({
  x: { grid: { display: false }, ticks: { maxTicksLimit: 7, maxRotation: 0 } },
  y: { grid: { color: C.grid }, border: { display: false }, ticks: { callback: yFmt, maxTicksLimit: 6 } }
});
function barColors(vals) { return vals.map(v => v >= 0 ? C.pos : C.neg); }

// Speicherverbrauch gegen die Gratis-Limits (Supabase Free: 1 GB Dateien, 500 MB Datenbank)
const LIMIT_SHOTS = 1024 ** 3, LIMIT_DB = 500 * 1024 ** 2;
const mb = b => b >= 1024 ** 3 ? num(b / 1024 ** 3, 2) + ' GB' : num(b / 1024 ** 2, b < 10 * 1024 ** 2 ? 1 : 0) + ' MB';
async function loadUsage() {
  const el = $('#usage'); if (!el) return;
  try {
    const u = await DS.usage(); if (!$('#usage')) return;
    const rs = u.shot_bytes / LIMIT_SHOTS, rd = u.db_bytes / LIMIT_DB, avg = u.shot_count ? u.shot_bytes / u.shot_count : 100 * 1024;
    const left = Math.max(0, Math.floor((LIMIT_SHOTS - u.shot_bytes) / avg));
    el.innerHTML = meter('Screenshots', `${mb(u.shot_bytes)} / 1 GB`, rs, `${u.shot_count} Bilder · Platz für ca. <b>${left.toLocaleString('de-DE')}</b> weitere`)
      + meter('Datenbank (Trades, Notizen)', `${mb(u.db_bytes)} / 500 MB`, rd, `${num(rd * 100, 1)} % belegt`)
      + (Math.max(rs, rd) >= 0.8 ? `<div class="alert" style="grid-column:1/-1">${ic('bolt')} Über 80 % belegt. Alte Screenshots können ins GitHub-Backup ausgelagert werden – siehe NOTFALLPLAN.md im Backup-Repository.</div>` : '')
      + (u.demo ? '<div class="dim" style="grid-column:1/-1;font-size:12px">Demo-Modus: keine echten Daten.</div>' : '');
  } catch (e) { el.innerHTML = '<div class="dim" style="font-size:13px">Speicherstand nicht abrufbar.</div>'; }
}

const AFTER = {
  einstellungen() { loadUsage(); },
  dashboard() {
    const eqs = equitySeries();
    const pts = eqs.pts;
    mk('c-eq', {
      type: 'line',
      data: { labels: pts.map(p => fDate(p.t, false)), datasets: [{ data: pts.map(p => p.y), borderColor: C.acc, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: .25, fill: true, backgroundColor: ctx => { const { chart } = ctx; const { ctx: c, chartArea } = chart; if (!chartArea) return 'transparent'; const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom); g.addColorStop(0, 'rgba(91,140,255,.28)'); g.addColorStop(1, 'rgba(91,140,255,0)'); return g; } }] },
      options: { interaction: { mode: 'index', intersect: false }, scales: axes(), plugins: { tooltip: { callbacks: { label: c => money(c.parsed.y) } } } }
    });
    const tr = S.trades.filter(t => accOk(t.account_id));
    const days = {};
    for (const t of tr) { const k = dayKey(t.close); days[k] = (days[k] || 0) + t.net; }
    const keys = Object.keys(days).sort().slice(-30);
    mk('c-daily', {
      type: 'bar',
      data: { labels: keys.map(k => k.slice(8, 10) + '.' + k.slice(5, 7)), datasets: [{ data: keys.map(k => days[k]), backgroundColor: barColors(keys.map(k => days[k])), borderRadius: 3, maxBarThickness: 18 }] },
      options: { scales: axes(), plugins: { tooltip: { callbacks: { label: c => money(c.parsed.y, true) } } } }
    });
  },
  statistik() {
    const tr = scopedTrades();
    const rs = tr.filter(t => t.r != null).map(t => t.r);
    const bins = []; for (let b = -3; b <= 5; b += 0.5) bins.push(b);
    const cnt = bins.map(() => 0);
    for (const r of rs) { const i = Math.max(0, Math.min(bins.length - 1, Math.floor((Math.max(-3, Math.min(5.49, r)) + 3) / 0.5))); cnt[i]++; }
    mk('c-r', { type: 'bar', data: { labels: bins.map(b => (b > 0 ? '+' : '') + b + 'R'), datasets: [{ data: cnt, backgroundColor: bins.map(b => b >= 0 ? C.pos : C.neg), borderRadius: 3 }] }, options: { scales: axes(v => v), plugins: { tooltip: { callbacks: { label: c => c.parsed.y + ' Trades' } } } } });
    const wd = [1, 2, 3, 4, 5, 6, 0].map(d => tr.filter(t => new Date(t.open).getDay() === d).reduce((s, t) => s + t.net, 0));
    mk('c-wd', { type: 'bar', data: { labels: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'], datasets: [{ data: wd, backgroundColor: barColors(wd), borderRadius: 4 }] }, options: { scales: axes(), plugins: { tooltip: { callbacks: { label: c => money(c.parsed.y, true) } } } } });
    const hrs = Array.from({ length: 24 }, (_, h) => tr.filter(t => new Date(t.open).getHours() === h).reduce((s, t) => s + t.net, 0));
    mk('c-hr', { type: 'bar', data: { labels: hrs.map((_, h) => h + ' h'), datasets: [{ data: hrs, backgroundColor: barColors(hrs), borderRadius: 3 }] }, options: { scales: axes(), plugins: { tooltip: { callbacks: { label: c => money(c.parsed.y, true) } } } } });
    const sc = tr.filter(t => t.risk && t.mae != null).map(t => ({ x: t.mae / t.risk, y: t.r }));
    mk('c-mae', { type: 'scatter', data: { datasets: [{ data: sc, pointRadius: 3.5, pointBackgroundColor: sc.map(p => p.y >= 0 ? 'rgba(31,199,126,.7)' : 'rgba(242,84,91,.7)'), pointBorderWidth: 0 }] }, options: { scales: { x: { grid: { color: C.grid }, title: { display: true, text: 'MAE (R)' } }, y: { grid: { color: C.grid }, title: { display: true, text: 'Ergebnis (R)' } } }, plugins: { tooltip: { callbacks: { label: c => `MAE ${rFmt(c.parsed.x)} · Ergebnis ${rFmt(c.parsed.y)}` } } } } });
  }
};

/* ---------------------------------------------------------------------
   Trade-Detail + Journal (Modal)
   --------------------------------------------------------------------- */
function openTrade(k) {
  const t = S.tradeMap.get(k); if (!t) return;
  const j = S.journal[k] || {};
  S.modal = { k, draft: { setup: j.setup || '', tags: [...(j.tags || [])], mistakes: [...(j.mistakes || [])], emotion: j.emotion || '', rating: j.rating || 0, plan_followed: j.plan_followed ?? null, planned_risk: j.planned_risk ?? '', notes: j.notes || '', screenshots: [...(j.screenshots || [])] }, busy: false };
  renderModal();
}
function closeModal() { S.modal = null; S.amodal = null; $('#modal').innerHTML = ''; document.body.style.overflow = ''; if (S.pendingRender) render(); }

function renderModal() {
  const M = S.modal; if (!M) return;
  const t = S.tradeMap.get(M.k);
  if (!t) { closeModal(); return; }
  const D = M.draft, st = S.settings;
  const acc = S.accounts.find(a => a.id === t.account_id);
  const sc = $('.sheet .bd'); const scrollTop = sc ? sc.scrollTop : 0;
  const chip = (field, v, multi, bad) => {
    const on = multi ? D[field].includes(v) : D[field] === v;
    return `<button class="chip ${on ? 'on' : ''} ${bad ? 'bad' : ''}" data-act="chip" data-f="${field}" data-v="${esc(v)}" data-m="${multi ? 1 : 0}">${esc(v)}</button>`;
  };
  const extra = (field, list) => D[field] && !list.includes(D[field]) ? [D[field]] : [];
  const extraM = (field, list) => D[field].filter(x => !list.includes(x));
  const mfeTot = (t.mfe || 0) - (t.mae || 0);
  const riskR = t.risk ? (v => rFmt(v / t.risk)) : (() => '');
  $('#modal').innerHTML = `
  <div class="ov" data-act="ov">
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="hd"><h2><span>${esc(t.symbol)}</span><span class="badge ${t.dir}">${t.dir === 'long' ? 'Long' : 'Short'}</span>${acc && S.accounts.length > 1 ? `<span class="badge">${esc(accName(acc))}</span>` : ''}</h2><button class="btn ghost sm" data-act="close" aria-label="Schließen">${ic('x')}</button></div>
      <div class="bd">
        <div class="hero"><div class="big num ${cls(t.net)}">${money(t.net, true)}</div><div class="num ${cls(t.r)}" style="font-size:18px;font-weight:600;padding-bottom:5px">${rFmt(t.r)}</div></div>
        <div class="facts">
          <div><div class="l">Eröffnet</div><div class="v">${fDate(t.open)}</div></div>
          <div><div class="l">Geschlossen</div><div class="v">${fDate(t.close)}</div></div>
          <div><div class="l">Dauer</div><div class="v">${dur(t.hold)}</div></div>
          <div><div class="l">Volumen</div><div class="v num">${num(t.volume)} Lot</div></div>
          <div><div class="l">Einstieg</div><div class="v num">${price(t.openPrice)}</div></div>
          <div><div class="l">Ausstieg</div><div class="v num">${price(t.closePrice)}</div></div>
          <div><div class="l">Initial SL</div><div class="v num">${price(t.sl)}</div></div>
          <div><div class="l">Initial TP</div><div class="v num">${price(t.tp)}</div></div>
          <div><div class="l">Risiko</div><div class="v num">${t.risk ? money(t.risk) : '–'}</div></div>
          <div><div class="l">Brutto</div><div class="v num ${cls(t.profit)}">${money(t.profit, true)}</div></div>
          <div><div class="l">Kommission</div><div class="v num">${money(t.commission + t.fee)}</div></div>
          <div><div class="l">Swap</div><div class="v num">${money(t.swap)}</div></div>
        </div>
        ${t.mfe != null || t.mae != null ? `<div class="field"><label>Max. Buchgewinn / -verlust (MFE / MAE)</label>
          <div class="row" style="justify-content:space-between;font-size:13px"><span class="neg num">MAE ${money(t.mae)} ${riskR(t.mae)}</span><span class="pos num">MFE ${money(t.mfe, true)} ${riskR(t.mfe)}</span></div>
          <div class="mfe">${mfeTot > 0 ? `<span style="left:0;width:${(-(t.mae || 0)) / mfeTot * 100}%;background:var(--neg);opacity:.55"></span><span style="left:${(-(t.mae || 0)) / mfeTot * 100}%;right:0;background:var(--pos);opacity:.55"></span><span style="left:${Math.max(0, Math.min(100, (t.net - (t.mae || 0)) / mfeTot * 100))}%;width:3px;background:#fff;margin-left:-1px"></span>` : ''}</div>
          <div class="dim" style="font-size:12px">Weißer Strich = realisierter Ausstieg${t.mfe > 0 && t.net > 0 ? ` · ${pct(Math.min(1, t.net / t.mfe), 0)} des MFE mitgenommen` : ''}</div></div>` : ''}

        <div class="sect" style="margin-top:6px">Journal</div>
        <div class="form">
        <div class="field"><label>Setup</label><div class="chips">${[...st.setups, ...extra('setup', st.setups)].map(v => chip('setup', v, false)).join('')}</div></div>
        <div class="field"><label>Tags</label><div class="chips">${[...st.tags, ...extraM('tags', st.tags)].map(v => chip('tags', v, true)).join('')}</div></div>
        <div class="field"><label>Fehler</label><div class="chips">${[...st.mistakes, ...extraM('mistakes', st.mistakes)].map(v => chip('mistakes', v, true, true)).join('')}</div></div>
        <div class="field"><label>Emotion</label><div class="chips">${[...st.emotions, ...extra('emotion', st.emotions)].map(v => chip('emotion', v, false)).join('')}</div></div>
        <div class="grid g2" style="gap:12px">
          <div class="field"><label>Bewertung der Ausführung</label><div>${[1, 2, 3, 4, 5].map(n => `<button class="starbtn ${D.rating >= n ? 'on' : ''}" data-act="star" data-v="${n}" aria-label="${n} Sterne">★</button>`).join('')}</div></div>
          <div class="field"><label>Plan befolgt?</label><div class="chips"><button class="chip ${D.plan_followed === true ? 'on' : ''}" data-act="plan" data-v="1">Ja</button><button class="chip bad ${D.plan_followed === false ? 'on' : ''}" data-act="plan" data-v="0">Nein</button></div></div>
        </div>
        <div class="field"><label>Geplantes Risiko (${esc(acc ? acc.currency : cur())}) – überschreibt automatisches R</label><input class="inp" type="number" inputmode="decimal" step="0.01" min="0" style="width:200px" value="${esc(D.planned_risk)}" data-df="planned_risk" placeholder="${S.meta[M.k] && S.meta[M.k].initial_risk ? 'auto: ' + num(S.meta[M.k].initial_risk) : 'z. B. 500'}"></div>
        <div class="field"><label>Notizen</label><textarea data-df="notes" placeholder="Warum bin ich rein? Was hat der Markt gemacht? Was nehme ich mit?" style="min-height:130px">${esc(D.notes)}</textarea></div>
        <div class="field"><label>Screenshots</label><div class="shots" id="shots">${D.screenshots.map((p, i) => `<div class="shot"><img data-src="${esc(p)}" alt="Screenshot ${i + 1}" data-act="zoom"><button data-act="shot-del" data-v="${i}">✕</button></div>`).join('')}
          <label class="upl">${M.busy ? '<div class="spin"></div>' : `<span>${ic('img')}<br>Bild hinzufügen</span>`}<input type="file" accept="image/*" multiple data-act="upload"></label></div></div>
        </div>
      </div>
      <div class="ft"><button class="btn ghost" data-act="close">Abbrechen</button><button class="btn pri" data-act="save-trade" ${M.busy ? 'disabled' : ''}>${ic('check')} Journal speichern</button></div>
    </div>
  </div>`;
  document.body.style.overflow = 'hidden';
  const bd = $('.sheet .bd'); if (bd) bd.scrollTop = scrollTop;
  $$('#shots img[data-src]').forEach(async img => { img.src = await DS.shotUrl(img.dataset.src); });
}

async function saveTrade() {
  const M = S.modal; if (!M) return;
  const t = S.tradeMap.get(M.k);
  const D = M.draft;
  const row = {
    account_id: t.account_id, position_id: t.position_id, setup: D.setup || null, tags: D.tags, mistakes: D.mistakes,
    emotion: D.emotion || null, rating: D.rating || null, plan_followed: D.plan_followed,
    planned_risk: D.planned_risk === '' || D.planned_risk == null ? null : +D.planned_risk, notes: D.notes || null, screenshots: D.screenshots
  };
  M.busy = true; renderModal();
  try {
    await DS.saveJournal(row);
    S.journal[M.k] = row;
    toast(`${ic('check')} Journal gespeichert`);
    S.modal = null; $('#modal').innerHTML = ''; document.body.style.overflow = '';
    buildTrades(); render();
  } catch (e) { M.busy = false; renderModal(); toast('Fehler beim Speichern: ' + esc(e.message || e)); }
}

/* ---------------------------------------------------------------------
   Events
   --------------------------------------------------------------------- */
function toast(html, ms = 3200) {
  const el = document.createElement('div'); el.className = 'toast'; el.innerHTML = html;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 320); }, ms);
}
async function copy(v) {
  try { await navigator.clipboard.writeText(v); toast(`${ic('copy')} Kopiert`); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = v; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(`${ic('copy')} Kopiert`); } catch (_) { toast('Kopieren nicht möglich'); }
    ta.remove();
  }
}
function exportCSV() {
  const tr = filteredTrades();
  const cols = ['Konto', 'Position', 'Symbol', 'Richtung', 'Eröffnet', 'Geschlossen', 'Volumen', 'Einstieg', 'Ausstieg', 'Brutto', 'Kommission', 'Swap', 'Gebühr', 'Netto', 'Risiko', 'R', 'MFE', 'MAE', 'Setup', 'Tags', 'Fehler', 'Emotion', 'Bewertung', 'Plan befolgt', 'Notizen'];
  const q = v => { v = v == null ? '' : String(v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const n = v => v == null || !isFinite(v) ? '' : String(Math.round(v * 1e6) / 1e6).replace('.', ',');
  const rows = tr.map(t => { const j = t.j || {}; const a = S.accounts.find(x => x.id === t.account_id) || {}; return [a.login, t.position_id, t.symbol, t.dir, new Date(t.open).toISOString(), new Date(t.close).toISOString(), n(t.volume), n(t.openPrice), n(t.closePrice), n(t.profit), n(t.commission), n(t.swap), n(t.fee), n(t.net), n(t.risk), n(t.r), n(t.mfe), n(t.mae), j.setup, (j.tags || []).join(', '), (j.mistakes || []).join(', '), j.emotion, j.rating, j.plan_followed == null ? '' : j.plan_followed ? 'ja' : 'nein', j.notes].map(q).join(';'); });
  const csv = '﻿' + cols.join(';') + '\n' + rows.join('\n');
  try {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `trading-journal-${dayKey(Date.now())}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`${ic('dl')} ${tr.length} Trades exportiert`);
  } catch (e) { copy(csv); }
}

function bind() {
  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act, v = el.dataset.v;
    if (act === 'ov') { if (e.target === el) closeModal(); return; }
    if (act === 'upload') return;
    switch (act) {
      case 'range': S.range = v; LS.set('range', v); render(); break;
      case 'trade': openTrade(el.dataset.k); break;
      case 'close': closeModal(); break;
      case 'more': S.listLimit += 60; render(); break;
      case 'ftoggle': S.showFilters = !S.showFilters; $('.filters').classList.toggle('open', S.showFilters); break;
      case 'export': exportCSV(); break;
      case 'copy': copy(v); break;
      case 'chip': {
        const D = S.modal.draft, f = el.dataset.f;
        if (el.dataset.m === '1') D[f] = D[f].includes(v) ? D[f].filter(x => x !== v) : [...D[f], v];
        else D[f] = D[f] === v ? '' : v;
        renderModal(); break;
      }
      case 'star': S.modal.draft.rating = S.modal.draft.rating === +v ? 0 : +v; renderModal(); break;
      case 'plan': { const b = v === '1'; S.modal.draft.plan_followed = S.modal.draft.plan_followed === b ? null : b; renderModal(); break; }
      case 'save-trade': saveTrade(); break;
      case 'edit-acc': openAccount(v); break;
      case 'save-acc': saveAccount(); break;
      case 'pick-acc': S.accountId = String(v); _selSet = null; LS.set('account', S.accountId); location.hash = 'dashboard'; if (S.view === 'dashboard') render(); break;
      case 'shot-del': {
        const p = S.modal.draft.screenshots[+v];
        S.modal.draft.screenshots.splice(+v, 1); renderModal();
        if (p && !p.startsWith('data:')) DS.removeShot(p).catch(() => { });
        break;
      }
      case 'zoom': { const lb = document.createElement('div'); lb.className = 'lightbox'; lb.innerHTML = `<img src="${el.src}" alt="">`; lb.onclick = () => lb.remove(); document.body.appendChild(lb); break; }
      case 'cal': {
        const n = +v, now = new Date();
        if (n === 0) S.calMonth = { y: now.getFullYear(), m: now.getMonth() };
        else { const d = new Date(S.calMonth.y, S.calMonth.m + n, 1); S.calMonth = { y: d.getFullYear(), m: d.getMonth() }; }
        render(); break;
      }
      case 'day': S.selDay = S.selDay === el.dataset.d ? null : el.dataset.d; render(); if (S.selDay) setTimeout(() => $('#daypanel') && $('#daypanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50); break;
      case 'mood': { $$('[data-act="mood"]').forEach(b => b.classList.toggle('on', b === el && !b.classList.contains('on'))); break; }
      case 'save-daily': {
        const k = el.dataset.d, box = el.closest('[data-form]');
        const moodEl = $('[data-act="mood"].on', box);
        const row = { day: k, mood: moodEl ? +moodEl.dataset.v : null, plan: $('[data-d="plan"]', box).value || null, review: $('[data-d="review"]', box).value || null, lessons: $('[data-d="lessons"]', box).value || null };
        el.disabled = true;
        try { await DS.saveDaily(row); S.daily[k] = row; S.editing = false; toast(`${ic('check')} Tagebuch gespeichert`); render(); }
        catch (err) { el.disabled = false; toast('Fehler: ' + esc(err.message || err)); }
        break;
      }
      case 'token-new': {
        const label = ($('#tok-label').value || 'MT5').trim();
        el.disabled = true;
        try { const tok = await DS.createToken(label); render(); await copy(tok); toast(`${ic('key')} Token erstellt und kopiert – jetzt im EA als InpSyncToken einfügen.`, 6000); }
        catch (err) { el.disabled = false; toast('Fehler: ' + esc(err.message || err)); }
        break;
      }
      case 'token-del': confirmDialog('Token widerrufen?', 'MT5-Terminals mit diesem Token können danach keine Daten mehr senden.', 'Widerrufen', async () => { try { await DS.deleteToken(v); render(); toast('Token widerrufen'); } catch (err) { toast('Fehler: ' + esc(err.message || err)); } }); break;
      case 'save-labels': {
        try { for (const inp of $$('[data-label]')) { const a = S.accounts.find(x => String(x.id) === inp.dataset.label); if (a && (a.label || '') !== inp.value.trim()) { await DS.saveAccountLabel(a.id, inp.value.trim() || null); a.label = inp.value.trim() || null; } } S.editing = false; toast(`${ic('check')} Gespeichert`); render(); }
        catch (err) { toast('Fehler: ' + esc(err.message || err)); }
        break;
      }
      case 'list-add': {
        const l = el.dataset.l, inp = $(`[data-listinp="${l}"]`), val = inp.value.trim();
        if (val && !S.settings[l].includes(val)) { S.settings[l].push(val); S.editing = false; await DS.saveSettings().catch(err => toast('Fehler: ' + esc(err.message))); render(); }
        break;
      }
      case 'list-del': { const l = el.dataset.l; S.settings[l] = S.settings[l].filter(x => x !== v); await DS.saveSettings().catch(err => toast('Fehler: ' + esc(err.message))); render(); break; }
      case 'reload': toast('Lade …'); await DS.load(); buildTrades(); render(); toast(`${ic('check')} Aktualisiert`); break;
      case 'logout': DS.signOut(); break;
      case 'demo-exit': LS.del('mode'); location.hash = ''; location.reload(); break;
      case 'dlg-cancel': $('#dlg') && $('#dlg').remove(); break;
    }
  });
  document.addEventListener('change', async e => {
    const el = e.target;
    if (el.dataset.act === 'upload') {
      const files = [...el.files]; if (!files.length || !S.modal) return;
      S.modal.busy = true; renderModal();
      try { for (const f of files) { const p = await DS.upload(f, S.modal.k); S.modal.draft.screenshots.push(p); } }
      catch (err) { toast('Upload fehlgeschlagen: ' + esc(err.message || err)); }
      if (S.modal) { S.modal.busy = false; renderModal(); }
      return;
    }
    if (el.dataset.am && S.amodal) {
      S.amodal.d[el.dataset.am] = el.value;
      if (el.dataset.am === 'preset') Object.assign(S.amodal.d, { target: '', daily: '', max: '', maxType: '', minDays: '' });
      if (el.dataset.am === 'type' || el.dataset.am === 'preset') renderAcctModal();
      return;
    }
    if (el.dataset.filter) {
      S.filters[el.dataset.filter] = el.type === 'checkbox' ? el.checked : el.value;
      S.listLimit = 60; render();
    }
  });
  let qT;
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.df && S.modal) S.modal.draft[el.dataset.df] = el.value;
    if (el.dataset.am && S.amodal) S.amodal.d[el.dataset.am] = el.value;
    if (el.dataset.filter === 'q') { clearTimeout(qT); qT = setTimeout(() => { S.filters.q = el.value; S.listLimit = 60; const pos = el.selectionStart; render(); const n = $('[data-filter="q"]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) { } } }, 220); }
  });
  document.addEventListener('focusin', e => { if (e.target.closest('#view .form, #view [data-label], #view [data-listinp], #view #tok-label')) S.editing = true; });
  document.addEventListener('focusout', e => {
    if (!e.target.closest('#view')) return;
    setTimeout(() => { const a = document.activeElement; if (!a || !a.closest('#view .form, #view [data-label], #view [data-listinp], #view #tok-label')) { S.editing = false; if (S.pendingRender) render(); } }, 150);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if ($('.lightbox')) $('.lightbox').remove(); else if (S.modal) closeModal(); } });
  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.mode === 'live') { DS.refresh(); Live.subscribe(); } });
  setInterval(() => { updateConn(); if (S.view === 'dashboard' && !S.editing && !S.modal && !S.amodal) { const z = $('#live-zone'); if (z) z.innerHTML = liveZone(); } }, 15000);
}

function confirmDialog(title, text, okLabel, onOk) {
  const d = document.createElement('div');
  d.className = 'ov'; d.id = 'dlg'; d.style.justifyContent = 'center';
  d.innerHTML = `<div class="dialog"><h3 style="margin:0 0 8px;font-size:17px">${esc(title)}</h3><p class="muted" style="margin:0 0 18px">${esc(text)}</p><div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="dlg-cancel">Abbrechen</button><button class="btn pri" id="dlg-ok">${esc(okLabel)}</button></div></div>`;
  document.body.appendChild(d);
  $('#dlg-ok').onclick = () => { d.remove(); onOk(); };
  d.addEventListener('click', e => { if (e.target === d) d.remove(); });
}

function route() {
  const h = location.hash.replace('#', '');
  const v = VIEWS.find(x => x.id === h);
  S.view = v ? v.id : 'dashboard';
  if (S.mode) { closeModal(); render(); window.scrollTo(0, 0); }
}

/* ---------------------------------------------------------------------
   Start, Login, Einrichtung
   --------------------------------------------------------------------- */
function screen(html) { $('#root').innerHTML = `<div class="auth"><div class="box">${html}</div></div>`; }
const LOGO = `<div class="brand" style="padding:0"><div class="logo">${ic('chart')}</div><div>Trading Journal<small>MetaTrader 5 Live-Sync</small></div></div>`;

function renderSetup(err = '') {
  screen(`${LOGO}<h1>Willkommen</h1><p>Verbinde dein Journal einmalig mit deinem Supabase-Projekt (kostenlos). Die Anleitung liegt der App bei.</p>
    <form id="f-setup"><input class="inp" name="url" placeholder="Supabase-URL (https://….supabase.co)" value="${esc(LS.get('sbUrl', ''))}" autocomplete="off" required>
    <input class="inp" name="key" placeholder="anon / publishable Key" value="${esc(LS.get('sbKey', ''))}" autocomplete="off" required>
    <div class="err">${esc(err)}</div><button class="btn pri" type="submit">Verbinden</button></form>
    <div style="text-align:center;margin:18px 0 0" class="muted">oder</div>
    <button class="btn" style="margin-top:12px" data-act-demo>${ic('bolt')} Demo mit Beispieldaten ansehen</button>`);
  $('#f-setup').onsubmit = e => {
    e.preventDefault();
    const url = e.target.url.value.trim().replace(/\/+$/, ''), key = e.target.key.value.trim();
    if (!/^https:\/\/.+/.test(url)) return renderSetup('Die URL muss mit https:// beginnen.');
    LS.set('sbUrl', url); LS.set('sbKey', key); boot();
  };
  $('[data-act-demo]').onclick = () => { LS.set('mode', 'demo'); boot(); };
}

function renderAuth(mode = 'login', msg = '', isErr = true) {
  screen(`${LOGO}<h1>${mode === 'login' ? 'Anmelden' : 'Konto erstellen'}</h1><p>${mode === 'login' ? 'Melde dich an, um dein Journal zu öffnen.' : 'Einmalig ein Konto für dein Journal anlegen.'}</p>
    <form id="f-auth"><input class="inp" type="email" name="email" placeholder="E-Mail" autocomplete="email" required>
    <input class="inp" type="password" name="pw" placeholder="Passwort (min. 8 Zeichen)" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" minlength="8" required>
    <div class="err" style="${isErr ? '' : 'color:var(--pos)'}">${esc(msg)}</div>
    <button class="btn pri" type="submit">${mode === 'login' ? 'Anmelden' : 'Registrieren'}</button></form>
    <div style="text-align:center;margin-top:16px"><button class="btn ghost" id="sw">${mode === 'login' ? 'Noch kein Konto? Registrieren' : 'Schon registriert? Anmelden'}</button></div>
    ${CFG.supabaseUrl ? '' : `<div style="text-align:center"><button class="btn ghost sm" id="reset" style="color:var(--tx3)">Supabase-Verbindung ändern</button></div>`}`);
  $('#sw').onclick = () => renderAuth(mode === 'login' ? 'signup' : 'login');
  const r = $('#reset'); if (r) r.onclick = () => renderSetup();
  $('#f-auth').onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
    const email = e.target.email.value.trim(), pw = e.target.pw.value;
    try {
      if (mode === 'login') { await Live.signIn(email, pw); start('live'); }
      else {
        const d = await Live.signUp(email, pw);
        if (d.session) start('live');
        else renderAuth('login', 'Fast geschafft: Bestätige den Link in deiner E-Mail und melde dich dann an.', false);
      }
    } catch (err) {
      btn.disabled = false;
      const m = String(err.message || err);
      e.target.querySelector('.err').textContent = /Invalid login/i.test(m) ? 'E-Mail oder Passwort falsch.' : /Email not confirmed/i.test(m) ? 'Bitte zuerst die E-Mail bestätigen.' : /fetch/i.test(m) ? 'Server nicht erreichbar – Supabase-URL prüfen.' : m;
    }
  };
}

async function start(mode) {
  S.mode = mode;
  DS = mode === 'demo' ? Demo : Live;
  $('#root').innerHTML = `<div class="center"><div style="text-align:center"><div class="spin" style="margin:0 auto 14px"></div><div class="muted">Lade dein Journal …</div></div></div>`;
  try { await DS.load(); }
  catch (e) {
    console.error(e);
    const m = String(e.message || e);
    screen(`${LOGO}<h1>Verbindung fehlgeschlagen</h1><p>${esc(/relation .* does not exist|schema cache/i.test(m) ? 'Die Datenbank ist noch nicht eingerichtet: Bitte supabase/schema.sql im Supabase SQL-Editor ausführen.' : m)}</p><button class="btn pri" onclick="location.reload()">Erneut versuchen</button><div style="height:10px"></div><button class="btn" id="lo">Abmelden</button>`);
    $('#lo').onclick = () => Live.signOut();
    return;
  }
  chartDefaults();
  buildTrades();
  shell();
  const h = location.hash.replace('#', '');
  S.view = VIEWS.find(v => v.id === h) ? h : 'dashboard';
  render();
  DS.subscribe();
}

async function boot() {
  if (!S._bound) { bind(); S._bound = true; }
  if (CFG.demo || LS.get('mode') === 'demo') return start('demo');
  const url = CFG.supabaseUrl || LS.get('sbUrl', ''), key = CFG.supabaseKey || LS.get('sbKey', '');
  if (!url || !key) return renderSetup();
  if (!window.supabase || !window.supabase.createClient) return screen(`${LOGO}<h1>Offline</h1><p>Die App-Bibliotheken konnten nicht geladen werden. Prüfe deine Internetverbindung.</p>`);
  try { Live.create(url, key); } catch (e) { return renderSetup('Ungültige Supabase-Daten: ' + e.message); }
  let session = null;
  try { session = await Live.session(); } catch (e) { }
  if (!session) return renderAuth();
  start('live');
}

if ('serviceWorker' in navigator && location.protocol === 'https:' && !CFG.demo) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { }); });
}
boot();
