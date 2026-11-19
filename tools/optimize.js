// Berechnet Musterlösungen (Runde 1–3) und Shapley-Werte. Aufruf: node tools/optimize.js
// Simulated Annealing über die Zuordnung Auftrag -> Lkw, Tourlängen exakt über game.solveTruck.
const G = require('../game');

function teamOf(tid) { return tid[0]; }

function score(assign, splitSet, env) {
  // assign: item -> truck
  const byTruck = {};
  for (const [it, tr] of Object.entries(assign)) (byTruck[tr] = byTruck[tr] || []).push(it);
  let km = 0, bad = 0, tours = 0;
  for (const [tr, ids] of Object.entries(byTruck)) {
    const r = G.solveTruck(G.TEAMS[teamOf(tr)].depot, ids, env);
    tours++;
    if (r.ok) km += r.km; else bad++;
  }
  return { km, bad, tours, val: km + bad * 100000 + tours * 1 + (splitSet ? Object.keys(splitSet).length * 0.5 : 0) };
}

function anneal(orderIds, teamKeys, { allowSplit = false, iters = 60000, restarts = 6, env = G.BASE_ENV, ownOnly = false } = {}) {
  const trucks = [];
  teamKeys.forEach(t => { for (let k = 1; k <= G.TRUCKS; k++) trucks.push(t + ':' + k); });
  const allowedTrucks = it => ownOnly ? trucks.filter(tr => tr[0] === G.ORDERS[it.replace(/[<>]$/, '')].team) : trucks;
  let globalBest = null;
  for (let rs = 0; rs < restarts; rs++) {
    let split = {};
    let assign = {};
    const items = () => orderIds.flatMap(id => split[id] ? [id + '>', id + '<'] : [id]);
    for (const it of items()) { const a = allowedTrucks(it); assign[it] = a[Math.floor(Math.random() * a.length)]; }
    let cur = score(assign, split, env), best = { assign: { ...assign }, split: { ...split }, s: cur };
    let T = 2000;
    for (let i = 0; i < iters; i++) {
      T = 2000 * Math.pow(0.0005, i / iters);
      const its = items();
      const na = { ...assign }; let ns = split;
      const r = Math.random();
      if (allowSplit && r < 0.08) {
        const cand = orderIds.filter(G.canSplit);
        const id = cand[Math.floor(Math.random() * cand.length)];
        ns = { ...split };
        if (ns[id]) { delete ns[id]; const tr = na[id + '>']; delete na[id + '>']; delete na[id + '<']; na[id] = tr; }
        else { ns[id] = true; const tr = na[id]; delete na[id]; na[id + '>'] = tr; na[id + '<'] = trucks[Math.floor(Math.random() * trucks.length)]; }
      } else if (r < 0.6) {
        const it = its[Math.floor(Math.random() * its.length)];
        const a = allowedTrucks(it); na[it] = a[Math.floor(Math.random() * a.length)];
      } else {
        const a = its[Math.floor(Math.random() * its.length)], b = its[Math.floor(Math.random() * its.length)];
        if (ownOnly && na[a][0] !== na[b][0]) continue;
        [na[a], na[b]] = [na[b], na[a]];
      }
      const s = score(na, ns, env);
      if (s.val < cur.val || Math.random() < Math.exp((cur.val - s.val) / T)) {
        assign = na; split = ns; cur = s;
        if (s.val < best.s.val) best = { assign: { ...na }, split: { ...ns }, s };
      }
    }
    if (!globalBest || best.s.val < globalBest.s.val) globalBest = best;
  }
  return globalBest;
}

function summarize(res, opts = {}) {
  const ev = G.evaluate(res.assign, { split: res.split, ...opts });
  return { km: ev.total.km, emptyKm: ev.total.emptyKm, tours: ev.total.tours, util: ev.total.util, co2: ev.total.co2, profit: ev.total.profit, cost: ev.total.cost };
}

const teams = Object.keys(G.TEAMS);
const out = {};
// Runde 1: jedes Team allein
const r1 = {};
for (const t of teams) {
  const res = anneal(G.BASE_IDS.filter(id => G.ORDERS[id].team === t), [t], { iters: 20000, restarts: 4 });
  Object.assign(r1, res.assign);
}
out.r1 = { plan: r1, ...summarize({ assign: r1, split: {} }) };
console.log('R1', out.r1.km, out.r1.emptyKm, out.r1.tours, out.r1.profit);
// Runde 2: alle zusammen
const r2 = anneal(G.BASE_IDS, teams, { iters: 150000, restarts: 8 });
out.r2 = { plan: r2.assign, ...summarize(r2) };
console.log('R2', out.r2.km, out.r2.emptyKm, out.r2.tours, out.r2.profit);
// Runde 3: mit Hub
const r3 = anneal(G.BASE_IDS, teams, { allowSplit: true, iters: 250000, restarts: 8 });
out.r3 = { plan: r3.assign, split: r3.split, ...summarize(r3) };
console.log('R3', out.r3.km, out.r3.emptyKm, out.r3.tours, out.r3.profit, Object.keys(r3.split));

// Shapley auf eingesparte km (Runde 2)
if (process.argv.includes('--shapley')) {
  const v = {};
  const subsets = [];
  for (let mask = 1; mask < 16; mask++) subsets.push(teams.filter((_, i) => mask & (1 << i)));
  const kmOf = {};
  for (const S of subsets) {
    const ids = G.BASE_IDS.filter(id => S.includes(G.ORDERS[id].team));
    const res = anneal(ids, S, { iters: S.length === 1 ? 20000 : 100000, restarts: S.length === 1 ? 4 : 6 });
    kmOf[S.join('')] = res.s.km;
    console.log('Koalition', S.join(''), res.s.km);
  }
  const single = t => kmOf[t];
  const val = S => S.length ? S.reduce((s, t) => s + single(t), 0) - kmOf[S.join('')] : 0;
  const fact = n => n <= 1 ? 1 : n * fact(n - 1);
  const sh = {};
  for (const t of teams) {
    let s = 0;
    for (const S of subsets.concat([[]])) {
      if (S.includes(t)) continue;
      const withT = teams.filter(x => S.includes(x) || x === t);
      s += fact(S.length) * fact(teams.length - S.length - 1) / fact(teams.length) * (val(withT) - val(S));
    }
    sh[t] = Math.round(s);
  }
  out.shapley = { alone: Object.fromEntries(teams.map(t => [t, kmOf[t]])), value: sh, total: val(teams) };
  console.log('Shapley', out.shapley);
}
require('fs').writeFileSync(__dirname + '/../solutions.json', JSON.stringify(out, null, 1));
