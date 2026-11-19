// Spedition 2040 – Multiplayer-Planspiel zum Physical Internet
// Start: node server.js   (Node 18+, keine weiteren Pakete nötig)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST_KEY = process.env.HOST_KEY || crypto.randomBytes(3).toString('hex');

// ---------------- Spieldaten ----------------
const CAP = 4;          // Paletten pro Lkw
const MAXKM = 1600;     // km pro Tour
const MAX_ORDERS = 5;   // Aufträge pro Lkw
const TRUCKS = 6;       // Lkw pro Spedition

const CITIES = {
  HH: { name: 'Hamburg', x: 390, y: 70 },
  B:  { name: 'Berlin', x: 620, y: 130 },
  K:  { name: 'Köln', x: 150, y: 270 },
  F:  { name: 'Frankfurt', x: 300, y: 340 },
  S:  { name: 'Stuttgart', x: 340, y: 480 },
  M:  { name: 'München', x: 560, y: 530 },
};
const DIST_LIST = {
  'HH-B': 290, 'HH-K': 425, 'HH-F': 495, 'HH-S': 655, 'HH-M': 775,
  'B-K': 575, 'B-F': 545, 'B-S': 630, 'B-M': 585,
  'K-F': 190, 'K-S': 370, 'K-M': 575,
  'F-S': 205, 'F-M': 395, 'S-M': 230,
};
function dist(a, b) {
  if (a === b) return 0;
  return DIST_LIST[a + '-' + b] ?? DIST_LIST[b + '-' + a];
}
const TEAMS = {
  N: { name: 'Nord', depot: 'HH', color: '#2B6CB0' },
  O: { name: 'Ost', depot: 'B', color: '#C05621' },
  W: { name: 'West', depot: 'K', color: '#2F855A' },
  S: { name: 'Süd', depot: 'M', color: '#6B46C1' },
};
const ORDERS = {};
[
  ['N1', 'N', 'HH', 'M', 3], ['N2', 'N', 'HH', 'S', 2], ['N3', 'N', 'HH', 'K', 2], ['N4', 'N', 'HH', 'B', 2], ['N5', 'N', 'F', 'HH', 1],
  ['O1', 'O', 'B', 'K', 3], ['O2', 'O', 'B', 'M', 2], ['O3', 'O', 'B', 'F', 2], ['O4', 'O', 'B', 'HH', 2], ['O5', 'O', 'S', 'B', 1],
  ['W1', 'W', 'K', 'HH', 3], ['W2', 'W', 'K', 'B', 2], ['W3', 'W', 'K', 'M', 2], ['W4', 'W', 'K', 'S', 1], ['W5', 'W', 'M', 'K', 2],
  ['S1', 'S', 'M', 'HH', 3], ['S2', 'S', 'M', 'B', 2], ['S3', 'S', 'M', 'K', 2], ['S4', 'S', 'S', 'F', 2], ['S5', 'S', 'M', 'F', 1],
].forEach(([id, team, from, to, p]) => { ORDERS[id] = { id, team, from, to, p }; });
const SHAPLEY = { alone: { N: 3605, O: 3295, W: 3175, S: 4260 }, value: { N: 1603, O: 1220, W: 1395, S: 1872 }, total: 6090 };
const SAMPLE = { r1: { tours: 12, km: 14335, emptyKm: 4495, util: 45 }, r2: { tours: 6, km: 8245, emptyKm: 0, util: 76 } };

// ---------------- Tour-Optimierer ----------------
// Findet für einen Lkw die kürzeste Route, die alle zugeteilten Aufträge abholt und zustellt
// (Kapazität 4 Paletten, max. 1.600 km, Start und Ende am Depot).
const cache = new Map();
function solveTruck(depot, ids) {
  if (!ids.length) return null;
  const key = depot + ':' + [...ids].sort().join(',');
  if (cache.has(key)) return cache.get(key);
  let res;
  if (ids.length > MAX_ORDERS) {
    res = { ok: false, reason: `Max. ${MAX_ORDERS} Aufträge pro Lkw` };
  } else {
    const os_ = ids.map(id => ORDERS[id]);
    const n = os_.length;
    const st = new Array(n).fill(0); // 0 = wartet, 1 = geladen, 2 = zugestellt
    let best = null, anyCapOk = false;
    const dfs = (cur, load, km, empty, palKm, route, done) => {
      if (best && km >= best.km) return;
      if (done === n) {
        anyCapOk = true;
        const back = dist(cur, depot);
        const tk = km + back;
        if (tk > MAXKM) return;
        const te = empty + (load === 0 ? back : 0);
        if (!best || tk < best.km || (tk === best.km && te < best.emptyKm)) {
          best = { km: tk, emptyKm: te, palKm, route: route.concat(depot) };
        }
        return;
      }
      for (let i = 0; i < n; i++) {
        const o = os_[i];
        if (st[i] === 0) {
          if (load + o.p > CAP) continue;
          const d = dist(cur, o.from);
          st[i] = 1;
          dfs(o.from, load + o.p, km + d, empty + (load === 0 ? d : 0), palKm + load * d, route.concat(o.from), done);
          st[i] = 0;
        } else if (st[i] === 1) {
          const d = dist(cur, o.to);
          st[i] = 2;
          dfs(o.to, load - o.p, km + d, empty, palKm + load * d, route.concat(o.to), done + 1);
          st[i] = 1;
        }
      }
    };
    dfs(depot, 0, 0, 0, 0, [depot], 0);
    if (best) {
      const r = best.route.filter((c, i, a) => i === 0 || c !== a[i - 1]);
      res = { ok: true, km: best.km, emptyKm: best.emptyKm, palKm: best.palKm, util: Math.round(best.palKm / (best.km * CAP) * 100), route: r };
    } else {
      res = { ok: false, reason: anyCapOk ? `Tour länger als ${MAXKM.toLocaleString('de-DE')} km` : 'Mehr als 4 Paletten gleichzeitig' };
    }
  }
  cache.set(key, res);
  return res;
}

// ---------------- Zustand ----------------
function freshState() {
  return {
    phase: 'lobby',            // lobby | r1 | r2 | results
    timerEnds: null,
    revealed: false,
    showShapley: false,
    publicUrl: process.env.PUBLIC_URL || '',
    players: {},               // cid -> {name, team, seen}
    plans: { r1: {}, r2: {} }, // orderId -> truckId ("N:1")
    log: [],
  };
}
let state = freshState();

function evaluate(round) {
  const plan = state.plans[round];
  const teams = {};
  for (const t of Object.keys(TEAMS)) {
    const trucks = [];
    let km = 0, emptyKm = 0, palKm = 0, tours = 0, invalid = 0;
    for (let k = 1; k <= TRUCKS; k++) {
      const tid = t + ':' + k;
      const ids = Object.keys(plan).filter(o => plan[o] === tid).sort();
      const r = solveTruck(TEAMS[t].depot, ids);
      trucks.push({ id: tid, orders: ids, result: r });
      if (r) {
        tours++;
        if (r.ok) { km += r.km; emptyKm += r.emptyKm; palKm += r.palKm; } else invalid++;
      }
    }
    const own = Object.values(ORDERS).filter(o => o.team === t).map(o => o.id);
    teams[t] = {
      trucks, tours, km, emptyKm, invalid,
      util: km ? Math.round(palKm / (km * CAP) * 100) : 0,
      palKm,
      assignedOwn: own.filter(o => plan[o]).length,
      carried: Object.keys(plan).filter(o => plan[o] && plan[o].startsWith(t + ':')).length,
    };
  }
  const all = Object.values(teams);
  const km = all.reduce((s, x) => s + x.km, 0);
  const palKm = all.reduce((s, x) => s + x.palKm, 0);
  return {
    teams,
    total: {
      km, emptyKm: all.reduce((s, x) => s + x.emptyKm, 0),
      tours: all.reduce((s, x) => s + x.tours, 0),
      invalid: all.reduce((s, x) => s + x.invalid, 0),
      util: km ? Math.round(palKm / (km * CAP) * 100) : 0,
      assigned: Object.keys(ORDERS).filter(o => plan[o]).length,
      complete: Object.keys(ORDERS).every(o => plan[o]) && all.every(x => x.invalid === 0),
    },
  };
}

function publicState() {
  const players = Object.entries(state.players).map(([cid, p]) => ({ name: p.name, team: p.team, online: Date.now() - p.seen < 30000 }));
  return {
    t: 'state', serverNow: Date.now(),
    phase: state.phase, timerEnds: state.timerEnds, revealed: state.revealed, showShapley: state.showShapley, publicUrl: state.publicUrl,
    players, plans: state.plans,
    eval: { r1: evaluate('r1'), r2: evaluate('r2') },
    log: state.log.slice(-8),
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
  }, 40);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 15000);

function addLog(text) { state.log.push({ at: Date.now(), text }); if (state.log.length > 50) state.log.shift(); }

// ---------------- Aktionen ----------------
function handle(body) {
  const { cid, action } = body;
  const isHost = body.key === HOST_KEY;
  const me = state.players[cid];
  if (me) me.seen = Date.now();

  switch (action) {
    case 'join': {
      const name = String(body.name || '').trim().slice(0, 24);
      if (!name) return { error: 'Bitte einen Namen eingeben.' };
      if (!TEAMS[body.team]) return { error: 'Bitte eine Spedition wählen.' };
      state.players[cid] = { name, team: body.team, seen: Date.now() };
      return { ok: true };
    }
    case 'assign': {
      if (!me) return { error: 'Bitte zuerst beitreten.' };
      const round = state.phase;
      if (round !== 'r1' && round !== 'r2') return { error: 'Gerade läuft keine Runde.' };
      const o = ORDERS[body.order];
      if (!o) return { error: 'Unbekannter Auftrag.' };
      const plan = state.plans[round];
      const cur = plan[o.id];
      const truck = body.truck;
      if (round === 'r1' && o.team !== me.team) return { error: 'In Runde 1 dürft ihr nur eigene Aufträge fahren.' };
      if (cur && !cur.startsWith(me.team + ':')) {
        return { error: `${o.id} fährt gerade Spedition ${TEAMS[cur[0]].name}. Verhandelt mit ihnen!` };
      }
      if (truck === null) {
        delete plan[o.id];
        if (round === 'r2' && cur) addLog(`${me.name} (${TEAMS[me.team].name}) gibt ${o.id} frei`);
        return { ok: true };
      }
      const m = /^([NOWS]):([1-6])$/.exec(String(truck));
      if (!m || m[1] !== me.team) return { error: 'Ihr dürft nur eure eigenen Lkw beladen.' };
      plan[o.id] = truck;
      if (round === 'r2' && o.team !== me.team && cur !== truck) addLog(`${TEAMS[me.team].name} übernimmt ${o.id} von ${TEAMS[o.team].name}`);
      return { ok: true };
    }
    case 'ping': return { ok: true, skip: true };
    // ----- Spielleitung -----
    case 'phase': {
      if (!isHost) return { error: 'Nur für die Spielleitung.' };
      if (!['lobby', 'r1', 'r2', 'results'].includes(body.phase)) return { error: 'Unbekannte Phase.' };
      state.phase = body.phase;
      const mins = { r1: 12, r2: 15 }[body.phase];
      state.timerEnds = mins ? Date.now() + mins * 60000 : null;
      if (body.phase === 'r2') addLog('Runde 2 gestartet: Die Frachtbörse ist offen!');
      return { ok: true };
    }
    case 'timer': {
      if (!isHost) return { error: 'Nur für die Spielleitung.' };
      const add = Number(body.minutes) || 0;
      const base = state.timerEnds && state.timerEnds > Date.now() ? state.timerEnds : Date.now();
      state.timerEnds = add === 0 ? null : base + add * 60000;
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
      if (state.plans[body.round]) state.plans[body.round] = {};
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('data: ' + JSON.stringify({ t: 'meta', cities: CITIES, teams: TEAMS, orders: ORDERS, trucks: TRUCKS, cap: CAP, maxKm: MAXKM, sample: SAMPLE, shapley: SHAPLEY, lan: lanUrls() }) + '\n\n');
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
      try { out = handle(JSON.parse(data || '{}')); } catch (e) { out = { error: 'Ungültige Anfrage.' }; }
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
