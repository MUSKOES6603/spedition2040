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
        G.state = msg;
        G.offset = msg.serverNow - Date.now();
        G.listeners.forEach(fn => fn(msg));
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
  G.fmt = n => Number(n || 0).toLocaleString('de-DE');
  G.cityName = c => G.meta.cities[c].name;
  G.route = r => r.map(c => c).join(' – ');
  G.esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  G.timerText = () => {
    const s = G.state;
    if (!s || !s.timerEnds) return '';
    const left = Math.max(0, Math.round((s.timerEnds - G.now()) / 1000));
    return String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
  };
  G.toast = (text, bad) => {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.textContent = text; el.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(G._tt); G._tt = setTimeout(() => { el.className = ''; }, 3200);
  };
  G.phaseName = p => ({ lobby: 'Warteraum', r1: 'Runde 1 · Jeder für sich', r2: 'Runde 2 · Physical Internet', results: 'Auswertung' }[p] || p);

  // Karte als SVG; routes = [{team, route:[...]}]
  G.mapSvg = (routes = [], opts = {}) => {
    const m = G.meta; const C = m.cities;
    const offs = { N: [-7, -7], O: [7, -7], W: [-7, 7], S: [7, 7] };
    let lines = '';
    routes.forEach(({ team, route }) => {
      const [dx, dy] = offs[team];
      for (let i = 0; i < route.length - 1; i++) {
        const a = C[route[i]], b = C[route[i + 1]];
        lines += `<line x1="${a.x + dx}" y1="${a.y + dy}" x2="${b.x + dx}" y2="${b.y + dy}" stroke="${m.teams[team].color}" stroke-width="7" stroke-linecap="round" opacity="0.75"/>`;
      }
    });
    const depots = Object.values(m.teams).map(t => t.depot);
    let nodes = '';
    for (const [k, c] of Object.entries(C)) {
      const isDepot = depots.includes(k);
      const team = Object.values(m.teams).find(t => t.depot === k);
      nodes += `<circle cx="${c.x}" cy="${c.y}" r="${isDepot ? 22 : 15}" fill="${isDepot ? '#E8772E' : '#14213D'}" stroke="#F5F2EA" stroke-width="4"/>`;
      const L = { HH: [30, 10, 'start'], B: [0, 58, 'middle'], K: [-6, -32, 'start'], F: [26, 10, 'start'], S: [26, 10, 'start'], M: [0, 60, 'middle'] }[k];
      const lx = c.x + L[0], ly = c.y + L[1], anchor = L[2];
      nodes += `<text x="${lx}" y="${ly}" text-anchor="${anchor}" font-size="${opts.small ? 28 : 26}" font-weight="700" fill="#14213D" font-family="system-ui, sans-serif">${c.name}${team ? ' · ' + team.name : ''}</text>`;
    }
    return `<svg viewBox="0 0 780 600" class="map" role="img" aria-label="Karte mit Routen">${lines}${nodes}</svg>`;
  };
  return G;
})();
