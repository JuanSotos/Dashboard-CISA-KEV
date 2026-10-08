/* ===========================================================================
   KEV Advisor — frontend. Descarga el catálogo en vivo desde /api/kev,
   calcula todas las métricas sobre los registros reales y dibuja el panel.
   =========================================================================== */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const fmt = n => n.toLocaleString("es-ES");
  const C = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const NS = "http://www.w3.org/2000/svg";
  const el = (t, a, txt) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); if (txt != null) e.textContent = txt; return e; };
  const clear = s => { while (s.firstChild) s.removeChild(s.firstChild); };
  const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

  const CWE = {
    "CWE-20": "Validación de entrada", "CWE-78": "Inyección de comandos OS", "CWE-787": "Escritura fuera de límites",
    "CWE-416": "Use-after-free", "CWE-119": "Error de buffer", "CWE-22": "Path traversal", "CWE-94": "Inyección de código",
    "CWE-502": "Deserialización insegura", "CWE-287": "Autenticación incorrecta", "CWE-306": "Falta de autenticación",
    "CWE-843": "Type confusion", "CWE-284": "Control de acceso", "CWE-77": "Inyección de comandos", "CWE-89": "Inyección SQL",
    "CWE-352": "CSRF", "CWE-434": "Subida de ficheros", "CWE-798": "Credenciales embebidas", "CWE-862": "Falta de autorización",
    "CWE-918": "SSRF", "CWE-269": "Gestión de privilegios", "CWE-noinfo": "Sin clasificar"
  };
  const cweName = c => CWE[c] || c;

  let STATE = { recs: [], meta: null, cumulative: false, vendor: null,
    q: "", rw: false, over: false, sort: "a", dir: -1, today: new Date() };

  // theme
  (function () {
    let saved = null; try { saved = localStorage.getItem("kev-theme"); } catch (e) {}
    if (saved) document.documentElement.setAttribute("data-theme", saved);
    $("#theme").addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", cur);
      try { localStorage.setItem("kev-theme", cur); } catch (e) {}
      if (STATE.recs.length) renderCharts();
    });
  })();

  // ---------------- data load ----------------
  async function load(refresh) {
    try {
      const res = await fetch("/api/kev" + (refresh ? "?refresh=1" : ""));
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || ("HTTP " + res.status));
      const data = await res.json();
      STATE.recs = data.records; STATE.meta = data.meta; STATE.fetchedAt = data.fetchedAt; STATE.source = data.source;
      onData();
    } catch (e) {
      $("#banner").className = "banner err";
      $("#banner").innerHTML = '<b>No se pudo cargar el catálogo.</b>&nbsp; ' + esc(e.message) +
        ' — comprueba tu conexión y pulsa actualizar.';
      $("#status").className = "pill err";
      $("#status-txt").textContent = "Sin conexión";
    }
  }

  function agoText(iso) {
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
    if (mins < 1) return "hace segundos";
    if (mins < 60) return "hace " + mins + " min";
    const h = Math.round(mins / 60); return "hace " + h + " h";
  }

  function onData() {
    const m = STATE.meta;
    $("#banner").hidden = true;
    ["kpis", "charts", "tools", "tablecard", "foot"].forEach(id => $("#" + id).hidden = false);
    $("#status").className = "pill";
    $("#status-txt").textContent = "En vivo · catálogo v" + (m.version || "—") + " · " + agoText(STATE.fetchedAt);
    $("#foot-meta").textContent = "versión " + (m.version || "—") + " (publicada " + (m.released || "—") + "), descargada " + agoText(STATE.fetchedAt);
    buildKpis(); renderCharts(); buildSuggest(); renderTable();
  }

  // ---------------- aggregates ----------------
  const ym = d => d.slice(0, 7);
  function monthly() {
    const roll = d3.rollup(STATE.recs, v => v.length, r => ym(r.a));
    const keys = [...roll.keys()].sort();
    const start = keys[0], end = keys[keys.length - 1];
    const out = []; let cum = 0;
    let [y, mo] = start.split("-").map(Number);
    const [ey, em] = end.split("-").map(Number);
    while (y < ey || (y === ey && mo <= em)) {
      const k = y + "-" + String(mo).padStart(2, "0");
      const c = roll.get(k) || 0; cum += c;
      out.push({ k, c, cum });
      mo++; if (mo > 12) { mo = 1; y++; }
    }
    return out;
  }
  const vendors = () => d3.rollups(STATE.recs, v => v.length, r => r.v).sort((a, b) => b[1] - a[1]);
  const cwes = () => d3.rollups(STATE.recs.flatMap(r => r.w.length ? r.w : ["CWE-noinfo"]), v => v.length, c => c).sort((a, b) => b[1] - a[1]);
  const byYear = () => d3.rollups(STATE.recs, v => v.length, r => r.a.slice(0, 4)).sort((a, b) => a[0] < b[0] ? -1 : 1);

  // ---------------- KPIs ----------------
  function buildKpis() {
    const N = STATE.recs.length;
    const rw = STATE.recs.filter(r => r.r).length;
    const t = STATE.today;
    const added30 = STATE.recs.filter(r => (t - new Date(r.a + "T00:00:00")) / 86400000 <= 30).length;
    const fo = STATE.recs.filter(r => r.f).length;
    const vn = new Set(STATE.recs.map(r => r.v)).size;
    const k = [
      { lab: "Total catálogo", num: fmt(N), sub: "explotadas activamente" },
      { lab: "Añadidas (30 días)", num: fmt(added30), sub: "altas recientes" },
      { lab: "Uso en ransomware", num: Math.round(rw / N * 100) + "%", sub: fmt(rw) + " vulnerabilidades", cls: "crit" },
      { lab: "Triaje forense", num: fmt(fo), sub: "lo exige la BOD 26-04", cls: "amber" },
      { lab: "Fabricantes", num: fmt(vn), sub: "afectados" },
    ];
    $("#kpis").innerHTML = k.map(x => `
      <div class="kpi ${x.cls || ""}">
        <span class="lab"><span class="d"></span>${x.lab}</span>
        <span class="num">${x.num}</span>
        <span class="sub">${x.sub}</span>
      </div>`).join("");
  }

  // ---------------- charts ----------------
  const tt = $("#tt");
  function showTT(html, x, y) { tt.innerHTML = html; tt.style.opacity = "1"; tt.style.left = (x + 14) + "px"; tt.style.top = (y - 10) + "px"; }
  function hideTT() { tt.style.opacity = "0"; }

  function drawTimeline() {
    const svg = $("#c-timeline"); clear(svg);
    const W = 580, H = 230, m = { t: 14, r: 16, b: 30, l: 42 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const data = monthly(), key = STATE.cumulative ? "cum" : "c";
    const x = d3.scaleLinear().domain([0, data.length - 1]).range([m.l, m.l + iw]);
    const maxY = d3.max(data, d => d[key]);
    const y = d3.scaleLinear().domain([0, maxY]).nice().range([m.t + ih, m.t]);
    const acc = C("--accent");
    // grid + y ticks
    y.ticks(4).forEach(v => {
      svg.appendChild(el("line", { x1: m.l, x2: m.l + iw, y1: y(v), y2: y(v), stroke: C("--grid") }));
      svg.appendChild(el("text", { x: m.l - 8, y: y(v) + 3, "text-anchor": "end", class: "barlabel" }, fmt(v)));
    });
    // area + line
    const line = data.map((d, i) => [x(i), y(d[key])]);
    const areaPath = "M" + line.map(p => p.join(" ")).join("L") + `L${x(data.length - 1)} ${y(0)}L${x(0)} ${y(0)}Z`;
    const gid = "grad-tl";
    const defs = el("defs"); const lg = el("linearGradient", { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
    lg.appendChild(el("stop", { offset: "0%", "stop-color": acc, "stop-opacity": .32 }));
    lg.appendChild(el("stop", { offset: "100%", "stop-color": acc, "stop-opacity": 0 }));
    defs.appendChild(lg); svg.appendChild(defs);
    svg.appendChild(el("path", { d: areaPath, fill: "url(#" + gid + ")" }));
    svg.appendChild(el("path", { d: "M" + line.map(p => p.join(" ")).join("L"), fill: "none", stroke: acc, "stroke-width": 2, "stroke-linejoin": "round" }));
    // x labels (years)
    const byYear = d3.rollups(data.map((d, i) => ({ y: d.k.slice(0, 4), i })), v => v.map(o => o.i), o => o.y);
    byYear.forEach(([yr, idxs]) => {
      const cx = (x(Math.min(...idxs)) + x(Math.max(...idxs))) / 2;
      svg.appendChild(el("text", { x: cx, y: m.t + ih + 16, "text-anchor": "middle", class: "barlabel" }, yr));
    });
    // hover hairline
    const hair = el("line", { x1: 0, x2: 0, y1: m.t, y2: m.t + ih, stroke: C("--muted"), "stroke-width": 1, opacity: 0 });
    const dot = el("circle", { r: 4, fill: acc, stroke: C("--panel"), "stroke-width": 2, opacity: 0 });
    svg.appendChild(hair); svg.appendChild(dot);
    const hit = el("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent", style: "cursor:crosshair" });
    svg.appendChild(hit);
    hit.addEventListener("mousemove", ev => {
      const r = svg.getBoundingClientRect(), sx = (ev.clientX - r.left) / r.width * W;
      let i = Math.round(x.invert(sx)); i = Math.max(0, Math.min(data.length - 1, i));
      const px = x(i), py = y(data[i][key]);
      hair.setAttribute("x1", px); hair.setAttribute("x2", px); hair.setAttribute("opacity", 1);
      dot.setAttribute("cx", px); dot.setAttribute("cy", py); dot.setAttribute("opacity", 1);
      const lbl = new Date(data[i].k + "-01").toLocaleDateString("es-ES", { month: "short", year: "numeric" });
      showTT(`<div class="d">${lbl}</div><div class="row"><span class="dot"></span>${STATE.cumulative ? "Acumulado" : "Altas"}<span class="v">${fmt(data[i][key])}</span></div>`, ev.clientX, ev.clientY);
    });
    hit.addEventListener("mouseleave", () => { hair.setAttribute("opacity", 0); dot.setAttribute("opacity", 0); hideTT(); });
  }

  function drawHBars(id, data, labelFn, colorVar, onClick) {
    const svg = $(id); clear(svg);
    const W = 580, rowH = 22, gap = 6, top = 6, labelW = 132, valW = 46;
    const items = data.slice(0, 11), maxV = d3.max(items, d => d[1]);
    const H = top + items.length * (rowH + gap);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const barX = labelW, barMax = W - labelW - valW, col = C(colorVar);
    items.forEach((d, i) => {
      const yy = top + i * (rowH + gap), w = Math.max(2, barMax * (d[1] / maxV));
      const g = el("g", { class: "hbar" });
      const active = STATE.vendor === d[0];
      if (onClick) { g.style.cursor = "pointer"; g.addEventListener("click", () => onClick(d[0])); }
      const name = labelFn(d[0]);
      const t = el("text", { x: labelW - 10, y: yy + rowH / 2 + 4, "text-anchor": "end", class: "barname" }, name.length > 20 ? name.slice(0, 19) + "…" : name);
      if (active) { t.setAttribute("font-weight", "700"); t.setAttribute("fill", col); }
      g.appendChild(t);
      g.appendChild(el("rect", { x: barX, y: yy + 3, width: barMax, height: rowH - 6, rx: 4, fill: C("--panel-3") }));
      g.appendChild(el("rect", { class: "fill", x: barX, y: yy + 3, width: w, height: rowH - 6, rx: 4, fill: col, opacity: active ? 1 : .88 }));
      g.appendChild(el("text", { x: barX + w + 7, y: yy + rowH / 2 + 4, class: "barlabel" }, fmt(d[1])));
      svg.appendChild(g);
    });
  }

  function drawYears() {
    const svg = $("#c-status"); clear(svg);
    const data = byYear();
    const W = 580, H = 290, m = { t: 18, r: 10, b: 40, l: 44 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const x = d3.scaleBand().domain(data.map(d => d[0])).range([m.l, m.l + iw]).padding(.3);
    const maxY = d3.max(data, d => d[1]);
    const y = d3.scaleLinear().domain([0, maxY]).nice().range([m.t + ih, m.t]);
    const acc = C("--accent");
    y.ticks(4).forEach(v => {
      svg.appendChild(el("line", { x1: m.l, x2: m.l + iw, y1: y(v), y2: y(v), stroke: C("--grid") }));
      svg.appendChild(el("text", { x: m.l - 8, y: y(v) + 3, "text-anchor": "end", class: "barlabel" }, fmt(v)));
    });
    data.forEach(d => {
      const bx = x(d[0]), bw = x.bandwidth(), by = y(d[1]), bh = (m.t + ih) - by;
      svg.appendChild(el("rect", { x: bx, y: by, width: bw, height: bh, rx: 6, fill: acc, opacity: .9 }));
      svg.appendChild(el("text", { x: bx + bw / 2, y: by - 7, "text-anchor": "middle", class: "barlabel" }, fmt(d[1])));
      svg.appendChild(el("text", { x: bx + bw / 2, y: m.t + ih + 18, "text-anchor": "middle", class: "barname" }, d[0]));
    });
  }

  function drawDonut() {
    const svg = $("#c-donut"); clear(svg);
    // Top 8 debilidades más frecuentes (sin un "Otros" que domine el anillo).
    const all = cwes().filter(d => d[0] !== "CWE-noinfo");
    const top = all.slice(0, 8);
    const parts = top.map((d, i) => ({ k: cweName(d[0]), v: d[1], c: C("--c" + (i + 1)) }));
    const total = parts.reduce((s, p) => s + p.v, 0);
    const cx = 95, cy = 95, r = 74, sw = 24;
    let a0 = -Math.PI / 2;
    parts.forEach(p => {
      const a1 = a0 + (p.v / total) * Math.PI * 2;
      const x1 = cx + r * Math.cos(a0), y1 = cy + r * Math.sin(a0), x2 = cx + r * Math.cos(a1), y2 = cy + r * Math.sin(a1);
      const large = (a1 - a0) > Math.PI ? 1 : 0;
      const path = el("path", { d: `M${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2}`, fill: "none", stroke: p.c, "stroke-width": sw });
      path.addEventListener("mousemove", ev => showTT(`<div class="row"><span class="dot" style="background:${p.c}"></span>${esc(p.k)}<span class="v">${fmt(p.v)}</span></div>`, ev.clientX, ev.clientY));
      path.addEventListener("mouseleave", hideTT);
      svg.appendChild(path); a0 = a1;
    });
    svg.appendChild(el("text", { x: cx, y: cy - 2, "text-anchor": "middle", "font-family": "var(--mono)", "font-size": 24, "font-weight": 700, fill: C("--text") }, fmt(STATE.recs.length)));
    svg.appendChild(el("text", { x: cx, y: cy + 16, "text-anchor": "middle", "font-size": 10.5, fill: C("--muted") }, "CVE"));
    $("#donut-legend").innerHTML = parts.map(p =>
      `<div class="row"><span class="sw" style="background:${p.c}"></span><span class="nm">${esc(p.k)}</span><span class="vl">${fmt(p.v)}</span></div>`).join("");
  }

  function renderCharts() { drawTimeline(); drawDonut(); drawVendors(); drawYears(); }
  function drawVendors() { drawHBars("#c-vendors", vendors(), v => v, "--accent", selectVendor); }
  function selectVendor(v) { STATE.vendor = STATE.vendor === v ? null : v; drawVendors(); renderTable(); if (STATE.vendor) $("#tablecard").scrollIntoView({ behavior: "smooth", block: "start" }); }

  $("#sw-cum").addEventListener("click", e => { STATE.cumulative = !STATE.cumulative; e.currentTarget.setAttribute("aria-pressed", STATE.cumulative); drawTimeline(); });
  $("#refresh").addEventListener("click", () => { $("#status-txt").textContent = "Actualizando…"; load(true); });

  // ---------------- table ----------------
  const tbody = $("#tbody");
  function filtered() {
    const q = STATE.q.toLowerCase(), t = STATE.today;
    let rows = STATE.recs.filter(r => {
      if (STATE.rw && !r.r) return false;
      if (STATE.over && !(r.due && new Date(r.due + "T00:00:00") < t)) return false;
      if (STATE.vendor && r.v !== STATE.vendor) return false;
      if (q) return (r.id + " " + r.v + " " + r.p + " " + r.n).toLowerCase().includes(q);
      return true;
    });
    const s = STATE.sort, dir = STATE.dir;
    rows.sort((a, b) => { const x = a[s] || "", y = b[s] || ""; return x < y ? -dir : x > y ? dir : 0; });
    return rows;
  }
  const CAP = 300;
  function renderTable() {
    const rows = filtered(), t = STATE.today;
    $("#tcount").textContent = fmt(rows.length) + " de " + fmt(STATE.recs.length);
    tbody.innerHTML = rows.slice(0, CAP).map(r => {
      const over = r.due && new Date(r.due + "T00:00:00") < t;
      return `<tr>
        <td class="cve"><a href="https://nvd.nist.gov/vuln/detail/${r.id}" target="_blank" rel="noopener">${r.id}</a></td>
        <td class="vp"><span class="v">${esc(r.v)}</span><br><span class="p">${esc(r.p)}</span></td>
        <td class="nm">${esc(r.n)}</td>
        <td class="dt">${r.a}</td>
        <td class="dt ${over ? "over" : ""}">${r.due || "—"}</td>
        <td><div class="flags">${r.r ? '<span class="tag rw">RANSOMWARE</span>' : ""}${r.f ? '<span class="tag fo">FORENSE</span>' : ""}</div></td>
      </tr>`;
    }).join("") + (rows.length > CAP ? `<tr><td colspan="6" style="text-align:center;color:var(--faint);font-family:var(--mono);font-size:11.5px;padding:12px">Mostrando ${CAP} · afina la búsqueda para ver el resto</td></tr>` : "");
    $("#empty").hidden = rows.length > 0;
  }
  $("#q").addEventListener("input", e => { STATE.q = e.target.value; renderTable(); });
  $("#chip-rw").addEventListener("click", e => { STATE.rw = !STATE.rw; e.target.setAttribute("aria-pressed", STATE.rw); renderTable(); });
  $("#chip-over").addEventListener("click", e => { STATE.over = !STATE.over; e.target.setAttribute("aria-pressed", STATE.over); renderTable(); });
  document.querySelectorAll("thead th[data-sort]").forEach(th => th.addEventListener("click", () => {
    const s = th.getAttribute("data-sort");
    if (STATE.sort === s) STATE.dir *= -1; else { STATE.sort = s; STATE.dir = (s === "a" || s === "due") ? -1 : 1; }
    document.querySelectorAll("thead th .ar").forEach(a => a.remove());
    const ar = document.createElement("span"); ar.className = "ar"; ar.textContent = STATE.dir < 0 ? " ▼" : " ▲"; th.appendChild(ar);
    renderTable();
  }));

  // ---------------- exposure checker ----------------
  const STOP = new Set("de la el en los las server client windows system".split(" "));
  $("#expo-run").addEventListener("click", () => {
    const lines = $("#expo-in").value.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) { $("#expo-summary").textContent = "Escribe al menos un producto o fabricante."; $("#expo-res").innerHTML = ""; return; }
    const t = STATE.today, found = new Map();
    for (const line of lines) {
      const toks = line.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w));
      if (!toks.length) continue;
      for (const r of STATE.recs) {
        const hay = (r.v + " " + r.p).toLowerCase();
        if (toks.some(w => hay.includes(w))) found.set(r.id, r);
      }
    }
    const hits = [...found.values()].sort((a, b) => (b.r - a.r) || ((a.due || "9999") < (b.due || "9999") ? -1 : 1));
    const rw = hits.filter(h => h.r).length, over = hits.filter(h => h.due && new Date(h.due + "T00:00:00") < t).length;
    $("#expo-summary").innerHTML = hits.length
      ? `<b style="color:var(--text)">${hits.length}</b> vulnerabilidades explotadas afectan a tu stack · <b style="color:var(--crit)">${rw}</b> usadas en ransomware · <b style="color:var(--amber)">${over}</b> con plazo vencido.`
      : "Sin coincidencias en el catálogo KEV para ese stack. 👍";
    $("#expo-res").innerHTML = hits.slice(0, 25).map(r => {
      const over = r.due && new Date(r.due + "T00:00:00") < t;
      return `<div class="hit">
        <div class="top"><a class="cve" href="https://nvd.nist.gov/vuln/detail/${r.id}" target="_blank" rel="noopener">${r.id}</a>
          ${r.r ? '<span class="tag rw">RANSOMWARE</span>' : ""}${over ? '<span class="tag fo">VENCIDA</span>' : ""}</div>
        <div class="nm">${esc(r.v)} ${esc(r.p)} — ${esc(r.n)}</div>
      </div>`;
    }).join("");
  });

  // ---------------- AI advisor ----------------
  function buildSuggest() {
    const top = vendors().slice(0, 3).map(v => v[0]);
    const chips = [
      "¿Qué vulnerabilidades de " + (top[0] || "Microsoft") + " debo priorizar?",
      "Dame las KEV usadas en ransomware con plazo vencido",
      "¿Qué CWE son más comunes y cómo me protejo?",
    ];
    $("#suggest").innerHTML = chips.map(c => `<span class="s">${esc(c)}</span>`).join("");
    document.querySelectorAll("#suggest .s").forEach(s => s.addEventListener("click", () => { $("#adv-q").value = s.textContent; ask(); }));
    fetch("/api/health").then(r => r.json()).then(h => { $("#adv-model").textContent = h.advisor ? (h.provider + " · " + h.model) : "configura .env"; }).catch(() => {});
  }
  function fmtAnswer(txt) {
    const lines = esc(txt).split("\n");
    let html = "", inList = false;
    for (let ln of lines) {
      ln = ln.replace(/(https?:\/\/[^\s)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
             .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
      if (/^\s*[-*]\s+/.test(ln)) { if (!inList) { html += "<ul>"; inList = true; } html += "<li>" + ln.replace(/^\s*[-*]\s+/, "") + "</li>"; }
      else { if (inList) { html += "</ul>"; inList = false; } if (ln.trim()) html += "<p>" + ln + "</p>"; }
    }
    if (inList) html += "</ul>";
    return html;
  }
  function addMsg(role, html, sources) {
    const d = document.createElement("div"); d.className = "msg " + role;
    d.innerHTML = `<span class="av">${role === "user" ? "Tú" : "IA"}</span><div class="bubble">${html}${sources && sources.length ? '<div class="srcs">' + sources.slice(0, 8).map(s => `<span class="s">${s}</span>`).join("") + "</div>" : ""}</div>`;
    $("#chat").appendChild(d); $("#chat").scrollTop = $("#chat").scrollHeight;
    return d;
  }
  let busy = false;
  const history = []; // {role, content} para dar continuidad a los seguimientos
  async function ask() {
    const q = $("#adv-q").value.trim(); if (!q || busy) return;
    busy = true; $("#adv-q").value = "";
    addMsg("user", "<p>" + esc(q) + "</p>");
    const typing = addMsg("bot", '<span class="typing"><i></i><i></i><i></i></span>');
    try {
      const res = await fetch("/api/advisor", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history: history.slice(-6) }),
      });
      const data = await res.json();
      typing.remove();
      if (!res.ok) { addMsg("bot", '<p style="color:var(--crit)">' + esc(data.error || "Error") + "</p>"); }
      else {
        addMsg("bot", fmtAnswer(data.answer), data.sources);
        history.push({ role: "user", content: q }, { role: "assistant", content: data.answer });
      }
    } catch (e) { typing.remove(); addMsg("bot", '<p style="color:var(--crit)">No se pudo contactar con el asesor: ' + esc(e.message) + "</p>"); }
    busy = false;
  }
  $("#adv-send").addEventListener("click", ask);
  $("#adv-q").addEventListener("keydown", e => { if (e.key === "Enter") ask(); });

  window.addEventListener("resize", () => { clearTimeout(window.__rt); window.__rt = setTimeout(() => { if (STATE.recs.length) renderCharts(); }, 180); });

  load(false);
})();
