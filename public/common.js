// Gemeinsame Hilfsfunktionen für Spieler- und Beamer-Ansicht
const Game = (() => {
  let cid = null;
  try { cid = localStorage.getItem('sp2040_cid'); } catch (e) {}
  if (!cid) {
    cid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem('sp2040_cid', cid); } catch (e) {}
  }
  const G = { cid, meta: null, state: null, offset: 0, listeners: [] };

  G.on = fn => G.listeners.push(fn);
  G.connect = () => {
    const es = new EventSource('/events');
    es.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.t === 'meta') { G.meta = msg; return; }
      if (msg.t === 'state') {
        const prev = G.state;
        if (prev && prev.phase !== msg.phase) G.hideEvent();
        G.state = msg;
        G.offset = msg.serverNow - Date.now();
        G.listeners.forEach(fn => fn(msg, prev));
      }
    };
    es.onerror = () => { document.body.classList.add('offline'); };
    es.onopen = () => { document.body.classList.remove('offline'); };
  };
  G.api = async (action, data = {}) => {
    try {
      const r = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cid, action, ...data }) });
      const j = await r.json();
      if (j.error) G.toast(j.error, true);
      return j;
    } catch (e) { G.toast('Keine Verbindung zum Server', true); return { error: 'offline' }; }
  };
  G.now = () => Date.now() + G.offset;
  G.fmt = n => Math.round(Number(n || 0)).toLocaleString('de-DE');
  G.eur = (n, sign) => (sign && n > 0 ? '+' : '') + (n < 0 ? '−' : '') + Math.abs(Math.round(n || 0)).toLocaleString('de-DE') + ' €';
  G.co2 = kg => (kg / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' t';
  G.cityName = c => G.meta.cities[c].name;
  G.route = r => r.join(' – ');
  G.esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  G.isRound = p => p === 'r1' || p === 'r2' || p === 'r3';
  G.timeLeft = () => { const s = G.state; return s && s.timerEnds ? Math.max(0, Math.round((s.timerEnds - G.now()) / 1000)) : null; };
  G.timerText = () => {
    const left = G.timeLeft();
    if (left === null) return '';
    return String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
  };
  G.toast = (text, bad) => {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.textContent = text; el.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(G._tt); G._tt = setTimeout(() => { el.className = ''; }, 3200);
  };
  G.phaseName = p => ({ lobby: 'Warteraum', r1: 'Runde 1 · Jeder für sich', r2: 'Runde 2 · Frachtbörse', r3: 'Runde 3 · PI-Hub', results: 'Auswertung' }[p] || p);
  G.teamColor = t => (G.meta.teams[t] || G.meta.market).color;
  G.teamName = t => (G.meta.teams[t] || G.meta.market).name;

  // Auftrag oder Teilstrecke ("N1>" = bis Hub, "N1<" = ab Hub)
  G.item = id => {
    const m = G.meta, last = id[id.length - 1];
    if (last === '>' || last === '<') {
      const o = m.orders[id.slice(0, -1)];
      return last === '>' ? { ...o, id, base: o.id, to: m.hub, leg: 1 } : { ...o, id, base: o.id, from: m.hub, leg: 2 };
    }
    return { ...m.orders[id], base: id, leg: 0 };
  };
  G.itemTag = id => { const it = G.item(id); return it.base + (it.leg === 1 ? ' ①' : it.leg === 2 ? ' ②' : ''); };
  G.priceOf = (round, id) => { const s = G.state; return (s.prices[round] && s.prices[round][id]) ?? G.meta.defaultPrices[id]; };
  // Welche Aufträge/Teilstrecken sind in dieser Runde aktiv?
  G.activeItems = round => {
    const s = G.state, m = G.meta, ev = s.events[round] || [], split = s.split[round] || {};
    return Object.values(m.orders).filter(o => !o.spot || ev.includes('spot'))
      .flatMap(o => split[o.id] ? [o.id + '>', o.id + '<'] : [o.id]);
  };
  G.blockedEdges = round => {
    const ev = (G.state.events[round] || []);
    const out = [];
    ev.forEach(id => { const e = G.meta.events[id]; if (e && e.distAdd) out.push(...Object.keys(e.distAdd)); });
    return out;
  };

  // ---------------- Karte ----------------
  // routes = [{team, route:[...]}]; opts: {small, hub, blocked:[...], trucks:bool}
  G.mapSvg = (routes = [], opts = {}) => {
    const m = G.meta; const C = m.cities;
    const offs = { N: [-7, -7], O: [7, -7], W: [-7, 7], S: [7, 7] };
    let bg = '';
    // Straßennetz dezent im Hintergrund
    const seen = new Set();
    for (const a of Object.keys(C)) for (const b of Object.keys(C)) {
      if (a >= b) continue; const k = [a, b].sort().join('-'); if (seen.has(k)) continue; seen.add(k);
      bg += `<line x1="${C[a].x}" y1="${C[a].y}" x2="${C[b].x}" y2="${C[b].y}" stroke="#14213D" stroke-opacity=".05" stroke-width="2"/>`;
    }
    let block = '';
    (opts.blocked || []).forEach(e => {
      const [a, b] = e.split('-'); const A = C[a], B = C[b];
      block += `<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke="#E53E3E" stroke-width="6" stroke-dasharray="10 9" opacity=".85"/>`;
      block += `<text x="${(A.x + B.x) / 2}" y="${(A.y + B.y) / 2}" font-size="30" text-anchor="middle" dominant-baseline="middle">🚧</text>`;
    });
    let lines = '', movers = '';
    routes.forEach(({ team, route }, idx) => {
      const [dx, dy] = offs[team] || [0, 0];
      const pts = route.map(c => [C[c].x + dx, C[c].y + dy]);
      lines += `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${G.teamColor(team)}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity="0.75"/>`;
      if (opts.trucks) {
        movers += `<g class="mv" data-pts="${pts.map(p => p.join(',')).join(' ')}" data-off="${(idx * 0.37) % 1}">
          <rect x="-15" y="-10" width="30" height="20" rx="5" fill="${G.teamColor(team)}" stroke="#fff" stroke-width="3"/>
          <rect x="6" y="-7" width="7" height="8" rx="1.5" fill="#fff" opacity=".9"/></g>`;
      }
    });
    const depots = Object.values(m.teams).map(t => t.depot);
    let nodes = '';
    for (const [k, c] of Object.entries(C)) {
      const isDepot = depots.includes(k);
      const team = Object.values(m.teams).find(t => t.depot === k);
      const isHub = opts.hub && k === m.hub;
      if (isHub) nodes += `<circle cx="${c.x}" cy="${c.y}" r="38" fill="none" stroke="#D69E2E" stroke-width="5" class="hubring"/><circle cx="${c.x}" cy="${c.y}" r="24" fill="#D69E2E" stroke="#F5F2EA" stroke-width="4"/><text x="${c.x}" y="${c.y + 1}" text-anchor="middle" dominant-baseline="middle" font-size="22" font-weight="800" fill="#14213D" font-family="system-ui, sans-serif">PI</text>`;
      else nodes += `<circle cx="${c.x}" cy="${c.y}" r="${isDepot ? 22 : 15}" fill="${isDepot ? team.color : '#14213D'}" stroke="#F5F2EA" stroke-width="4"/>`;
      const L = { HH: [30, 10, 'start'], B: [0, 58, 'middle'], K: [-6, -32, 'start'], F: [isHub ? 44 : 26, 10, 'start'], S: [26, 10, 'start'], M: [0, 60, 'middle'] }[k];
      nodes += `<text x="${c.x + L[0]}" y="${c.y + L[1]}" text-anchor="${L[2]}" font-size="${opts.small ? 28 : 26}" font-weight="700" fill="#14213D" font-family="system-ui, sans-serif">${c.name}${team ? ' · ' + team.name : ''}${isHub ? ' · Hub' : ''}</text>`;
    }
    return `<svg viewBox="0 0 780 600" class="map" role="img" aria-label="Karte mit Routen">${bg}${block}${lines}${nodes}${movers}</svg>`;
  };

  // Lkw fahren entlang ihrer Route (zeitbasiert, damit Neuzeichnen nicht ruckelt)
  const ptsCache = new WeakMap();
  function animate(ts) {
    document.querySelectorAll('.mv').forEach(g => {
      let d = ptsCache.get(g);
      if (!d) {
        const pts = g.dataset.pts.split(' ').map(p => p.split(',').map(Number));
        const seg = []; let len = 0;
        for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); seg.push(l); len += l; }
        d = { pts, seg, len, off: Number(g.dataset.off) || 0 };
        ptsCache.set(g, d);
      }
      if (!d.len) return;
      const speed = 120; // Pixel pro Sekunde
      let pos = ((ts / 1000 * speed) / d.len + d.off) % 1 * d.len;
      let i = 0; while (i < d.seg.length - 1 && pos > d.seg[i]) { pos -= d.seg[i]; i++; }
      const a = d.pts[i], b = d.pts[i + 1], f = d.seg[i] ? Math.min(1, pos / d.seg[i]) : 0;
      const x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
      const flip = b[0] < a[0] ? -1 : 1;
      g.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${flip},1)`);
    });
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  // ---------------- Sound (WebAudio, ohne Dateien) ----------------
  let ac = null;
  G.soundOn = false;
  G.enableSound = () => { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); G.soundOn = true; } catch (e) {} };
  function tone(freq, dur, type = 'sine', vol = 0.18, when = 0) {
    if (!G.soundOn || !ac) return;
    const t = ac.currentTime + when, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  G.sound = kind => {
    if (kind === 'tick') tone(880, 0.08, 'square', 0.08);
    if (kind === 'start') { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.2, i * 0.12)); }
    if (kind === 'end') { tone(196, 1.2, 'sawtooth', 0.18); tone(147, 1.4, 'sawtooth', 0.14, 0.05); }
    if (kind === 'alarm') { for (let i = 0; i < 4; i++) { tone(740, 0.16, 'square', 0.12, i * 0.32); tone(554, 0.16, 'square', 0.12, i * 0.32 + 0.16); } }
    if (kind === 'deal') { tone(1319, 0.09, 'triangle', 0.15); tone(1760, 0.18, 'triangle', 0.15, 0.08); }
    if (kind === 'fanfare') { [392, 523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, i === 6 ? 0.8 : 0.18, 'triangle', 0.2, i * 0.14)); }
  };

  // ---------------- Ereignis-Overlay ----------------
  let shownEvent = 0;
  G.handleEvent = (ev, big) => {
    if (!ev || ev.at <= shownEvent) return false;
    const fresh = G.now() - ev.at < 12000;
    shownEvent = ev.at;
    if (!fresh || ev.on === false) return false;
    let el = document.getElementById('evo');
    if (!el) { el = document.createElement('div'); el.id = 'evo'; document.body.appendChild(el); }
    el.className = big ? 'big show' : 'show';
    el.innerHTML = `<div class="evbox"><div class="evicon">${ev.icon}</div><div><div class="evtitle">${G.esc(ev.title)}</div><div class="evtext">${G.esc(ev.text)}</div></div></div>`;
    el.onclick = () => { el.className = ''; };
    clearTimeout(G._evt); G._evt = setTimeout(() => { el.className = ''; }, big ? 9000 : 7000);
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    G.sound('alarm');
    return true;
  };

  G.hideEvent = () => { const el = document.getElementById('evo'); if (el) el.className = ''; };

  // ---------------- Konfetti ----------------
  G.confetti = () => {
    const c = document.createElement('canvas'); c.id = 'confetti';
    c.width = innerWidth; c.height = innerHeight; document.body.appendChild(c);
    const x = c.getContext('2d'); const cols = ['#E8772E', '#2B6CB0', '#C05621', '#2F855A', '#6B46C1', '#D69E2E', '#F5F2EA'];
    const ps = Array.from({ length: 260 }, () => ({ x: Math.random() * c.width, y: -20 - Math.random() * c.height * 0.6, vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 5, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.3, w: 8 + Math.random() * 8, h: 5 + Math.random() * 6, c: cols[Math.floor(Math.random() * cols.length)] }));
    const t0 = performance.now();
    (function frame(t) {
      x.clearRect(0, 0, c.width, c.height);
      ps.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.04; p.r += p.vr; x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); x.restore(); });
      if (t - t0 < 6000) requestAnimationFrame(frame); else c.remove();
    })(t0);
  };
  return G;
})();
