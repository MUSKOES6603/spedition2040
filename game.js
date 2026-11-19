// Spedition 2040 – Spiellogik (Daten, Tour-Optimierer, Wirtschaft, Ereignisse)
// Wird vom Server und vom Musterlösungs-Skript (tools/optimize.js) genutzt.

const CAP = 4;          // Paletten pro Lkw
const MAXKM = 1600;     // km pro Tour
const MAX_ORDERS = 5;   // Aufträge pro Lkw
const TRUCKS = 6;       // Lkw pro Spedition
const HUB = 'F';        // Physical-Internet-Hub (Runde 3)

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
function baseDist(a, b) {
  if (a === b) return 0;
  return DIST_LIST[a + '-' + b] ?? DIST_LIST[b + '-' + a];
}
const TEAMS = {
  N: { name: 'Nord', depot: 'HH', color: '#2B6CB0' },
  O: { name: 'Ost', depot: 'B', color: '#C05621' },
  W: { name: 'West', depot: 'K', color: '#2F855A' },
  S: { name: 'Süd', depot: 'M', color: '#6B46C1' },
};
const MARKET = { name: 'Spotmarkt', color: '#D69E2E' };

// ---------------- Wirtschaft ----------------
const ECON = {
  rate: 0.80,        // € je Palette und Direkt-km (Frachterlös des Kunden)
  costKm: 1.00,      // € je gefahrenem km (Diesel, Maut, Fahrer, Verschleiß)
  tourFix: 150,      // € je eingesetztem Lkw (Fixkosten Fahrzeug/Tag)
  co2Km: 0.8,        // kg CO₂ je km
  co2Price: 150,     // € je Tonne CO₂ (Preis 2040)
  penalty: 150,      // € Vertragsstrafe je nicht gefahrenem eigenem Auftrag
  hubFee: 20,        // € Umschlag je Palette am Hub (Runde 3)
  spotFactor: 1.8,   // Spot-Aufträge zahlen den 1,8-fachen Satz
  priceShare: 0.7,   // Start-Frachtpreis in der Börse = 70 % des Erlöses
};

const ORDERS = {};
[
  ['N1', 'N', 'HH', 'M', 3], ['N2', 'N', 'HH', 'S', 2], ['N3', 'N', 'HH', 'K', 2], ['N4', 'N', 'HH', 'B', 2], ['N5', 'N', 'F', 'HH', 1],
  ['O1', 'O', 'B', 'K', 3], ['O2', 'O', 'B', 'M', 2], ['O3', 'O', 'B', 'F', 2], ['O4', 'O', 'B', 'HH', 2], ['O5', 'O', 'S', 'B', 1],
  ['W1', 'W', 'K', 'HH', 3], ['W2', 'W', 'K', 'B', 2], ['W3', 'W', 'K', 'M', 2], ['W4', 'W', 'K', 'S', 1], ['W5', 'W', 'M', 'K', 2],
  ['S1', 'S', 'M', 'HH', 3], ['S2', 'S', 'M', 'B', 2], ['S3', 'S', 'M', 'K', 2], ['S4', 'S', 'S', 'F', 2], ['S5', 'S', 'M', 'F', 1],
  // Spot-Aufträge (nur aktiv, wenn das Ereignis „Spot-Aufträge“ läuft)
  ['E1', 'X', 'F', 'B', 2], ['E2', 'X', 'S', 'HH', 2], ['E3', 'X', 'K', 'M', 1],
].forEach(([id, team, from, to, p]) => {
  const spot = team === 'X';
  ORDERS[id] = { id, team, from, to, p, spot, rev: Math.round(p * baseDist(from, to) * ECON.rate * (spot ? ECON.spotFactor : 1) / 10) * 10 };
});
const BASE_IDS = Object.keys(ORDERS).filter(id => !ORDERS[id].spot);
const SPOT_IDS = Object.keys(ORDERS).filter(id => ORDERS[id].spot);

// ---------------- Ereignisse ----------------
const EVENTS = {
  stau: {
    icon: '🚧', title: 'Vollsperrung A7!',
    text: 'Zwischen Kassel und Würzburg geht nichts mehr. Alle Fahrten von Hamburg nach Frankfurt, Stuttgart und München: +150 km Umweg.',
    toggle: true, distAdd: { 'HH-F': 150, 'HH-S': 150, 'HH-M': 150 },
  },
  diesel: {
    icon: '⛽', title: 'Dieselpreis-Schock!',
    text: 'Eine Ölkrise treibt die Preise: Jeder gefahrene Kilometer kostet ab sofort 40 % mehr.',
    toggle: true, costMul: 1.4,
  },
  co2: {
    icon: '🌍', title: 'CO₂-Preis verdreifacht!',
    text: 'Die EU zieht die Klimaziele an: 450 € statt 150 € pro Tonne CO₂. Leerfahrten werden richtig teuer.',
    toggle: true, co2Mul: 3,
  },
  spot: {
    icon: '⚡', title: 'Spot-Aufträge!',
    text: 'Drei Eilaufträge sind auf dem Markt (1,8-facher Frachtsatz). Jedes Team darf sie fahren: Wer zuerst lädt, kassiert!',
    toggle: true,
  },
  panne: {
    icon: '🔧', title: 'Lkw-Panne!',
    text: 'Motorschaden auf der Autobahn. Der Lkw fällt für diese Runde aus, seine Ladung muss neu verplant werden.',
    toggle: false,
  },
};

function makeEnv(events = []) {
  const distAdd = {};
  let costKm = ECON.costKm, co2Price = ECON.co2Price;
  for (const id of events) {
    const e = EVENTS[id]; if (!e) continue;
    if (e.distAdd) for (const [k, v] of Object.entries(e.distAdd)) distAdd[k] = (distAdd[k] || 0) + v;
    if (e.costMul) costKm *= e.costMul;
    if (e.co2Mul) co2Price *= e.co2Mul;
  }
  const dist = (a, b) => {
    if (a === b) return 0;
    return baseDist(a, b) + (distAdd[a + '-' + b] || distAdd[b + '-' + a] || 0);
  };
  const kmCost = costKm + ECON.co2Km * co2Price / 1000; // € je km inkl. CO₂-Kosten
  const spot = events.includes('spot');
  return { dist, costKm, co2Price, kmCost, spot, sig: Object.keys(distAdd).sort().map(k => k + distAdd[k]).join(',') };
}
const BASE_ENV = makeEnv([]);

// Teilstrecken in Runde 3: "N1>" = Abholort → Hub, "N1<" = Hub → Ziel
function getOrder(id) {
  const last = id[id.length - 1];
  if (last === '>' || last === '<') {
    const o = ORDERS[id.slice(0, -1)];
    if (!o) return null;
    return last === '>' ? { id, base: o.id, team: o.team, from: o.from, to: HUB, p: o.p, leg: 1 }
                        : { id, base: o.id, team: o.team, from: HUB, to: o.to, p: o.p, leg: 2 };
  }
  const o = ORDERS[id];
  return o ? { ...o, base: o.id, leg: 0 } : null;
}
function canSplit(id) { const o = ORDERS[id]; return !!o && !o.spot && o.from !== HUB && o.to !== HUB; }

// ---------------- Tour-Optimierer ----------------
// Kürzeste Route für einen Lkw, die alle zugeteilten Aufträge abholt und zustellt
// (Kapazität 4 Paletten, max. 1.600 km, Start und Ende am Depot).
const cache = new Map();
function solveTruck(depot, ids, env = BASE_ENV) {
  if (!ids.length) return null;
  const key = env.sig + '|' + depot + ':' + [...ids].sort().join(',');
  if (cache.has(key)) return cache.get(key);
  let res;
  if (ids.length > MAX_ORDERS) {
    res = { ok: false, reason: `Max. ${MAX_ORDERS} Aufträge pro Lkw` };
  } else {
    const dist = env.dist;
    const os_ = ids.map(getOrder);
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
  if (cache.size > 200000) cache.clear();
  cache.set(key, res);
  return res;
}

function defaultPrice(id) { return Math.round(ORDERS[id].rev * ECON.priceShare / 10) * 10; }

// ---------------- Bewertung einer Runde ----------------
// plan: auftrag/teilstrecke -> "N:1"; opts: { events, split: {N1:true}, prices: {N1: 300}, broken: ["O:2"] }
function evaluate(plan, opts = {}) {
  const events = opts.events || [];
  const env = makeEnv(events);
  const split = opts.split || {}, prices = opts.prices || {}, broken = opts.broken || [];
  const teams = {};
  const delivered = {}; // id (inkl. Teilstrecken) -> Team, das liefert
  for (const t of Object.keys(TEAMS)) {
    const trucks = [];
    let km = 0, emptyKm = 0, palKm = 0, tours = 0, invalid = 0;
    for (let k = 1; k <= TRUCKS; k++) {
      const tid = t + ':' + k;
      const ids = Object.keys(plan).filter(o => plan[o] === tid).sort();
      const r = solveTruck(TEAMS[t].depot, ids, env);
      trucks.push({ id: tid, orders: ids, result: r, broken: broken.includes(tid) });
      if (r) {
        tours++;
        if (r.ok) { km += r.km; emptyKm += r.emptyKm; palKm += r.palKm; ids.forEach(i => { delivered[i] = t; }); } else invalid++;
      }
    }
    teams[t] = { trucks, tours, km, emptyKm, invalid, palKm, util: km ? Math.round(palKm / (km * CAP) * 100) : 0,
      co2: Math.round(km * ECON.co2Km), cost: Math.round(km * env.kmCost + tours * ECON.tourFix),
      revenue: 0, paid: 0, received: 0, penalty: 0, hubFees: 0, done: 0, carried: 0, assignedOwn: 0 };
  }
  // Erlöse, Frachtzahlungen, Strafen
  const active = BASE_IDS.concat(env.spot ? SPOT_IDS : []);
  let doneCount = 0, assigned = 0;
  for (const id of active) {
    const o = ORDERS[id];
    const isSplit = !!split[id] && canSplit(id);
    const parts = isSplit ? [id + '>', id + '<'] : [id];
    if (parts.every(p => plan[p])) assigned++;
    if (!o.spot && parts.every(p => plan[p])) teams[o.team].assignedOwn++;
    const ok = parts.every(p => delivered[p]);
    parts.forEach(p => { if (delivered[p]) teams[delivered[p]].carried++; });
    if (!ok) { if (!o.spot) teams[o.team].penalty += ECON.penalty; continue; }
    doneCount++;
    if (o.spot) { teams[delivered[id]].revenue += o.rev; teams[delivered[id]].done++; continue; }
    const T = teams[o.team];
    T.revenue += o.rev; T.done++;
    const price = prices[id] ?? defaultPrice(id);
    if (isSplit) {
      T.hubFees += o.p * ECON.hubFee;
      const d1 = baseDist(o.from, HUB), d2 = baseDist(HUB, o.to);
      [[id + '>', d1], [id + '<', d2]].forEach(([p, d]) => {
        const c = delivered[p];
        if (c !== o.team) { const pay = Math.round(price * d / (d1 + d2)); T.paid += pay; teams[c].received += pay; }
      });
    } else if (delivered[id] !== o.team) {
      T.paid += price; teams[delivered[id]].received += price;
    }
  }
  for (const T of Object.values(teams)) T.profit = T.revenue + T.received - T.paid - T.cost - T.penalty - T.hubFees;
  const all = Object.values(teams);
  const sum = f => all.reduce((s, x) => s + x[f], 0);
  const km = sum('km'), palKmT = sum('palKm');
  return {
    teams,
    total: {
      km, emptyKm: sum('emptyKm'), tours: sum('tours'), invalid: sum('invalid'),
      util: km ? Math.round(palKmT / (km * CAP) * 100) : 0,
      co2: sum('co2'), cost: sum('cost'), revenue: sum('revenue'), penalty: sum('penalty'), profit: sum('profit'),
      assigned, active: active.length, done: doneCount,
      complete: doneCount === active.length && sum('invalid') === 0,
    },
  };
}

module.exports = {
  CAP, MAXKM, MAX_ORDERS, TRUCKS, HUB, CITIES, TEAMS, MARKET, ECON, ORDERS, BASE_IDS, SPOT_IDS, EVENTS,
  BASE_ENV, baseDist, makeEnv, getOrder, canSplit, solveTruck, evaluate, defaultPrice,
};
