// Spedition 2040 – Multiplayer-Planspiel zum Physical Internet
// Start: node server.js   (Node 18+, keine weiteren Pakete nötig)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const G = require('./game');

const PORT = Number(process.env.PORT) || 3000;
const HOST_KEY = process.env.HOST_KEY || crypto.randomBytes(3).toString('hex');
const ROUNDS = ['r1', 'r2', 'r3'];
const MINUTES = { r1: 12, r2: 15, r3: 12 };

// ---------------- Musterlösungen (vorberechnet mit tools/optimize.js) ----------------
const SOL = JSON.parse(fs.readFileSync(path.join(__dirname, 'solutions.json'), 'utf8'));
function routesOfEval(ev) {
  const out = [];
  for (const [k, te] of Object.entries(ev.teams)) te.trucks.forEach(t => { if (t.result && t.result.ok) out.push({ team: k, route: t.result.route }); });
  return out;
}
const SAMPLE = {};
for (const r of ROUNDS) {
  const ev = G.evaluate(SOL[r].plan, { split: SOL[r].split || {} });
  const t = ev.total;
  SAMPLE[r] = { tours: t.tours, km: t.km, emptyKm: t.emptyKm, util: t.util, co2: t.co2, profit: t.profit, routes: routesOfEval(ev), split: Object.keys(SOL[r].split || {}) };
}
const SHAPLEY = SOL.shapley;

// ---------------- Zustand ----------------
function freshState() {
  return {
    phase: 'lobby',            // lobby | r1 | r2 | r3 | results
    timerEnds: null,
    revealed: false,
    showShapley: false,
    publicUrl: process.env.PUBLIC_URL || '',
    players: {},               // cid -> {name, team, seen}
    plans: { r1: {}, r2: {}, r3: {} },   // auftrag/teilstrecke -> "N:1"
    prices: { r1: {}, r2: {}, r3: {} },  // auftrag -> € Frachtpreis
    split: { r1: {}, r2: {}, r3: {} },   // auftrag -> true (am Hub geteilt)
    events: { r1: [], r2: [], r3: [] },  // aktive Ereignisse je Runde
    broken: { r1: [], r2: [], r3: [] },  // ausgefallene Lkw
    lastEvent: null,
    log: [],
    seq: 0,
  };
}
let state = freshState();

function evalRound(r) {
  return G.evaluate(state.plans[r], { events: state.events[r], split: state.split[r], prices: state.prices[r], broken: state.broken[r] });
}

function publicState() {
  const players = Object.values(state.players).map(p => ({ name: p.name, team: p.team, online: Date.now() - p.seen < 45000 }));
  return {
    t: 'state', serverNow: Date.now(),
    phase: state.phase, timerEnds: state.timerEnds, revealed: state.revealed, showShapley: state.showShapley, publicUrl: state.publicUrl,
    players, plans: state.plans, prices: state.prices, split: state.split, events: state.events, broken: state.broken,
    lastEvent: state.lastEvent,
    eval: { r1: evalRound('r1'), r2: evalRound('r2'), r3: evalRound('r3') },
    log: state.log.slice(-12),
  };
}

// ---------------- Live-Verbindungen (Server-Sent Events) ----------------
const clients = new Set();
let pending = null;
function broadcast() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    const msg = 'data: ' + JSON.stringify(publicState()) + '\n\n';
    for (const res of clients) res.write(msg);
  }, 60);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 15000);

function addLog(text, kind = '', key = null) {
  const last = state.log[state.log.length - 1];
  if (key && last && last.key === key && Date.now() - last.at < 15000) { last.text = text; last.at = Date.now(); return; }
  state.log.push({ id: ++state.seq, at: Date.now(), text, kind, key });
  if (state.log.length > 60) state.log.shift();
}
const lbl = id => id.endsWith('>') ? id.slice(0, -1) + ' (Teil ①)' : id.endsWith('<') ? id.slice(0, -1) + ' (Teil ②)' : id;
const tn = t => (G.TEAMS[t] ? G.TEAMS[t].name : G.MARKET.name);

// Wer fährt diesen Auftrag (ganz oder eine Teilstrecke) gerade, außer dem eigenen Team?
function foreignCarrier(plan, id, team) {
  for (const p of [id, id + '>', id + '<']) if (plan[p] && plan[p][0] !== team) return plan[p][0];
  return null;
}

function triggerEvent(id) {
  const r = state.phase;
  const E = G.EVENTS[id];
  const list = state.events[r];
  let text = E.text, title = E.title, on = true;
  if (E.toggle) {
    if (list.includes(id)) {
      state.events[r] = list.filter(x => x !== id); on = false;
      if (id === 'spot') G.SPOT_IDS.forEach(o => { delete state.plans[r][o]; });
      addLog(`${E.icon} Ereignis beendet: ${E.title.replace('!', '')}`, 'event');
      return;
    }
    list.push(id);
  } else if (id === 'panne') {
    const plan = state.plans[r];
    const cands = [];
    for (const t of Object.keys(G.TEAMS)) for (let k = 1; k <= G.TRUCKS; k++) {
      const tid = t + ':' + k;
      if (state.broken[r].includes(tid)) continue;
      const n = Object.values(plan).filter(v => v === tid).length;
      cands.push({ tid, n });
    }
    const used = cands.filter(c => c.n > 0);
    const pool = used.length ? used : cands;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (!pick) return;
    state.broken[r].push(pick.tid);
    const freed = Object.keys(plan).filter(o => plan[o] === pick.tid);
    freed.forEach(o => { delete plan[o]; });
    title = `Panne bei Spedition ${tn(pick.tid[0])}!`;
    text = `Lkw ${pick.tid.split(':')[1]} hat einen Motorschaden und fällt für diese Runde aus.` + (freed.length ? (freed.length === 1 ? ` Auftrag ${freed[0].replace(/[<>]$/, '')} muss neu verplant werden.` : ` ${freed.length} Aufträge (${[...new Set(freed.map(x => x.replace(/[<>]$/, '')))].join(', ')}) müssen neu verplant werden.`) : '');
  }
  state.lastEvent = { id, icon: E.icon, title, text, at: Date.now(), on };
  addLog(`${E.icon} ${title}`, 'event');
}

// ---------------- Aktionen ----------------
function handle(body) {
  const { cid, action } = body;
  const isHost = body.key === HOST_KEY;
  const me = state.players[cid];
  if (me) me.seen = Date.now();
  const round = state.phase;
  const inRound = ROUNDS.includes(round);

  switch (action) {
    case 'join': {
      const name = String(body.name || '').trim().slice(0, 24);
      if (!name) return { error: 'Bitte einen Namen eingeben.' };
      if (!G.TEAMS[body.team]) return { error: 'Bitte eine Spedition wählen.' };
      state.players[cid] = { name, team: body.team, seen: Date.now() };
      return { ok: true };
    }
    case 'assign': {
      if (!me) return { error: 'Bitte zuerst beitreten.' };
      if (!inRound) return { error: 'Gerade läuft keine Runde.' };
      const item = String(body.order || '');
      const o = G.getOrder(item);
      if (!o) return { error: 'Unbekannter Auftrag.' };
      const plan = state.plans[round];
      const env = G.makeEnv(state.events[round]);
      if (o.spot && !env.spot) return { error: 'Dieser Spot-Auftrag ist nicht mehr am Markt.' };
      if (o.leg && (round !== 'r3' || !state.split[round][o.base])) return { error: 'Dieser Auftrag ist nicht am Hub geteilt.' };
      if (!o.leg && state.split[round][o.base]) return { error: 'Der Auftrag ist geteilt – bitte die Teilstrecken verplanen.' };
      if (round === 'r1' && !o.spot && o.team !== me.team) return { error: 'In Runde 1 dürft ihr nur eigene Aufträge fahren.' };
      const cur = plan[item];
      if (cur && cur[0] !== me.team) return { error: `${lbl(item)} fährt gerade Spedition ${tn(cur[0])}. Verhandelt mit ihnen!` };
      const truck = body.truck;
      if (truck === null) {
        delete plan[item];
        if (round !== 'r1' && cur && o.team !== me.team) addLog(`${tn(me.team)} gibt ${lbl(item)} wieder frei`, 'free');
        return { ok: true };
      }
      const m = /^([NOWS]):([1-6])$/.exec(String(truck));
      if (!m || m[1] !== me.team) return { error: 'Ihr dürft nur eure eigenen Lkw beladen.' };
      if (state.broken[round].includes(truck)) return { error: 'Dieser Lkw hat eine Panne und fällt aus.' };
      plan[item] = truck;
      if (!cur && o.spot) addLog(`⚡ ${tn(me.team)} schnappt sich Spot-Auftrag ${item}!`, 'spot');
      else if (!cur && o.team !== me.team) {
        const price = state.prices[round][o.base] ?? G.defaultPrice(o.base);
        addLog(`🤝 ${tn(me.team)} übernimmt ${lbl(item)} von ${tn(o.team)}` + (round === 'r1' ? '' : ` (${price} €${o.leg ? ' anteilig' : ''})`), 'deal');
      }
      return { ok: true };
    }
    case 'split': {
      if (!me) return { error: 'Bitte zuerst beitreten.' };
      if (round !== 'r3') return { error: 'Den Hub gibt es erst in Runde 3.' };
      const id = String(body.order || '');
      if (!G.canSplit(id)) return { error: 'Dieser Auftrag kann nicht am Hub geteilt werden.' };
      const plan = state.plans[round];
      if (plan[id] || plan[id + '>'] || plan[id + '<']) return { error: 'Erst aus dem Lkw nehmen, dann teilen bzw. zusammenführen.' };
      if (body.on) state.split[round][id] = true; else delete state.split[round][id];
      addLog(body.on ? `🔀 ${id} wird am Hub ${G.CITIES[G.HUB].name} umgeschlagen` : `${id} fährt wieder direkt`, 'hub');
      return { ok: true };
    }
    case 'price': {
      if (!me) return { error: 'Bitte zuerst beitreten.' };
      if (round !== 'r2' && round !== 'r3') return { error: 'Frachtpreise gibt es ab Runde 2.' };
      const o = G.ORDERS[body.order];
      if (!o || o.spot) return { error: 'Unbekannter Auftrag.' };
      if (o.team !== me.team) return { error: 'Den Preis legt die auftraggebende Spedition fest.' };
      if (foreignCarrier(state.plans[round], o.id, me.team)) return { error: 'Der Auftrag ist schon vergeben – Preis ist fix.' };
      const cur = state.prices[round][o.id] ?? G.defaultPrice(o.id);
      const next = Math.max(0, Math.min(Math.round(o.rev * 1.5), cur + (Number(body.delta) || 0)));
      state.prices[round][o.id] = next;
      addLog(`💶 ${tn(me.team)} bietet ${next} € für ${o.id} (${G.CITIES[o.from].name} → ${G.CITIES[o.to].name})`, 'price', 'price:' + o.id);
      return { ok: true };
    }
    case 'ping': return { ok: true, skip: true };
    // ----- Spielleitung -----
    case 'phase': {
      if (!isHost) return { error: 'Nur für die Spielleitung.' };
      if (!['lobby', 'results', ...ROUNDS].includes(body.phase)) return { error: 'Unbekannte Phase.' };
      state.phase = body.phase;
      const mins = MINUTES[body.phase];
      state.timerEnds = mins ? Date.now() + mins * 60000 : null;
      if (body.phase === 'r1') addLog('▶ Runde 1 gestartet: Jeder für sich!', 'phase');
      if (body.phase === 'r2') addLog('▶ Runde 2 gestartet: Die Frachtbörse ist offen!', 'phase');
      if (body.phase === 'r3') addLog(`▶ Runde 3 gestartet: Hub ${G.CITIES[G.HUB].name} ist in Betrieb!`, 'phase');
      return { ok: true };
    }
    case 'timer': {
      if (!isHost) return { error: 'Nur für die Spielleitung.' };
      const add = Number(body.minutes) || 0;
      const base = state.timerEnds && state.timerEnds > Date.now() ? state.timerEnds : Date.now();
      state.timerEnds = add === 0 ? null : base + add * 60000;
      return { ok: true };
    }
    case 'event': {
      if (!isHost) return { error: 'Nur für die Spielleitung.' };
      if (!inRound) return { error: 'Ereignisse gibt es nur während einer Runde.' };
      if (!G.EVENTS[body.id]) return { error: 'Unbekanntes Ereignis.' };
      triggerEvent(body.id);
      return { ok: true };
    }
    case 'clearEvents': {
      if (!isHost) return { error: 'Nur für die Spielleitung.' };
      if (!inRound) return { error: 'Gerade läuft keine Runde.' };
      G.SPOT_IDS.forEach(o => { delete state.plans[round][o]; });
      state.events[round] = []; state.broken[round] = [];
      addLog('Alle Ereignisse dieser Runde aufgehoben', 'event');
      return { ok: true };
    }
    case 'reveal': {
      if (!isHost) return { error: 'Nur für die Spielleitung.' };
      state.revealed = !state.revealed; return { ok: true };
    }
    case 'shapley': {
      if (!isHost) return { error: 'Nur für die Spielleitung.' };
      state.showShapley = !state.showShapley; return { ok: true };
    }
    case 'publicUrl': {
      if (!isHost) return { error: 'Nur für die Spielleitung.' };
      state.publicUrl = String(body.url || '').trim().slice(0, 200); return { ok: true };
    }
    case 'resetRound': {
      if (!isHost) return { error: 'Nur für die Spielleitung.' };
      const r = body.round;
      if (!ROUNDS.includes(r)) return { error: 'Gerade läuft keine Runde.' };
      state.plans[r] = {}; state.prices[r] = {}; state.split[r] = {}; state.events[r] = []; state.broken[r] = [];
      return { ok: true };
    }
    case 'reset': {
      if (!isHost) return { error: 'Nur für die Spielleitung.' };
      const keepPlayers = body.keepPlayers ? state.players : {};
      const url = state.publicUrl;
      state = freshState(); state.players = keepPlayers; state.publicUrl = url;
      return { ok: true };
    }
    case 'hostCheck': return { ok: isHost };
    default: return { error: 'Unbekannte Aktion.' };
  }
}

// ---------------- HTTP ----------------
const PUB = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${PORT}`);
  }
  return out;
}

const META = () => ({
  t: 'meta', cities: G.CITIES, teams: G.TEAMS, market: G.MARKET, orders: G.ORDERS, trucks: G.TRUCKS, cap: G.CAP, maxKm: G.MAXKM,
  hub: G.HUB, econ: G.ECON, events: G.EVENTS, minutes: MINUTES, sample: SAMPLE, shapley: SHAPLEY, lan: lanUrls(),
  defaultPrices: Object.fromEntries(G.BASE_IDS.map(id => [id, G.defaultPrice(id)])),
});

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('data: ' + JSON.stringify(META()) + '\n\n');
    res.write('data: ' + JSON.stringify(publicState()) + '\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api' && req.method === 'POST') {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let out;
      try { out = handle(JSON.parse(data || '{}')); } catch (e) { console.error(e); out = { error: 'Ungültige Anfrage.' }; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
      if (out.ok && !out.skip) broadcast();
    });
    return;
  }
  let file = url.pathname === '/' ? 'index.html' : url.pathname === '/host' ? 'host.html' : url.pathname.slice(1);
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  const fp = path.join(PUB, file);
  if (!fp.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Nicht gefunden'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const lan = lanUrls();
  console.log('\n  ============================================');
  console.log('   SPEDITION 2040 – Physical-Internet-Planspiel');
  console.log('  ============================================\n');
  console.log('  Beamer / Spielleitung (dieses Fenster nicht teilen!):');
  console.log(`    http://localhost:${PORT}/host?key=${HOST_KEY}\n`);
  console.log('  Mitspieler öffnen im gleichen WLAN:');
  (lan.length ? lan : [`http://localhost:${PORT}`]).forEach(u => console.log('    ' + u));
  console.log('\n  Beenden mit Ctrl+C\n');
});
