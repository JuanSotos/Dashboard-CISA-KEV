/* 03 · Mi exposición — comprobador de inventario y asesor IA (/api/advisor). */
import { $, $$, esc, fmt, corners, dueStatus, nvd, tag } from "../util.js";
import { icon } from "../icons.js";
import { S, D } from "../data.js";

const DEFAULT_STACK = "FortiOS 7.2.8\nIvanti Connect Secure 22.7R2\nMicrosoft Exchange Server 2019 CU14\nVMware ESXi 8.0 U2\nnginx 1.24.0";
const SUGGESTIONS = ["¿Qué venció esta semana?", "Resume las altas de los últimos 7 días", "¿Qué implica «triaje forense»?"];
const MAX_HITS = 1; // coincidencias mostradas por línea (el resto se resume en "+N")

/* =====================================================================
   Comprobador
   ===================================================================== */
// Misma regla de coincidencia que antes: palabras de 3+ letras de cada línea
// buscadas en "fabricante producto". Ahora el resultado se agrupa por línea.
const STOP = new Set("de la el en los las server client windows system".split(" "));
const tokens = line => line.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w));
const lines = text => text.split("\n").map(l => l.trim()).filter(Boolean);

function check(text) {
  return lines(text).map(line => {
    const toks = tokens(line);
    const hits = [];
    if (toks.length) for (const r of D.rows) {
      const hay = (r.vendor + " " + r.product).toLowerCase();
      const n = toks.filter(w => hay.includes(w)).length;
      if (n) hits.push({ r, n });
    }
    // Primero las coincidencias más específicas; después ransomware y las altas más recientes.
    hits.sort((a, b) => b.n - a.n || b.r.rw - a.r.rw || b.r.added.localeCompare(a.r.added));
    return { line, hits: hits.map(h => h.r) };
  });
}

function hitBlock(r) {
  return `<div class="ck-name">${esc(r.name)}</div>
    <div class="ck-tags">${r.rw ? tag.rw() : ""}${dueStatus(r)}</div>`;
}

function renderResults() {
  const out = $("#ck-out");
  if (S.checkStatus === "checking") {
    out.innerHTML = `<div class="ck-loading" aria-busy="true">
      <div class="sub">Analizando ${fmt(lines(S.stackText).length)} componentes…</div>
      <div class="sk" style="opacity:.7"></div><div class="sk" style="opacity:.5"></div><div class="sk" style="opacity:.3"></div></div>`;
    return;
  }
  const res = S.checkResults;
  if (!res.length) { out.innerHTML = ""; return; }
  const exposed = res.filter(x => x.hits.length);
  const rwN = exposed.filter(x => x.hits.some(h => h.rw)).length;
  const overN = exposed.filter(x => x.hits.some(h => h.isOverdue)).length;
  out.innerHTML = `<div class="ck-res">
    <div class="ck-sum">
      <span class="ck-big">${fmt(exposed.length)} de ${fmt(res.length)} expuestos</span>
      <span class="ck-sev">${fmt(rwN)} con ransomware</span>
      <span class="ck-sev">${fmt(overN)} vencidas</span>
    </div>
    ${res.map(x => {
      if (!x.hits.length) return `<div class="ck-row">${icon("check", 18, { label: "Sin coincidencias", cls: "ok" })}
        <div class="ck-line"><span class="muted">«${esc(x.line)}»</span> <span class="ok-ink">Sin coincidencias en KEV</span></div></div>`;
      const [first, ...rest] = x.hits;
      const more = rest.slice(0, MAX_HITS - 1), extra = x.hits.length - 1 - more.length;
      return `<div class="ck-row">${icon("triangle-alert", 18, { label: "Expuesto", cls: "crit" })}
        <div class="ck-body">
          <div class="ck-id"><span class="sub">«${esc(x.line)}»</span><span class="sub" aria-hidden="true">→</span><a class="cve" href="${first.url}" target="_blank" rel="noopener">${first.cve}</a></div>
          ${hitBlock(first)}
          ${more.map(r => `<div class="ck-more"><a class="cve" href="${r.url}" target="_blank" rel="noopener">${r.cve}</a>${hitBlock(r)}</div>`).join("")}
          ${extra > 0 ? `<div class="sub">+${fmt(extra)} coincidencias más en el catálogo</div>` : ""}
        </div></div>`;
    }).join("")}
    <div class="ck-note sub">Coincidencia por nombre de producto. Confirma la versión afectada en el aviso del fabricante.</div>
  </div>`;
}

function runCheck() {
  if (!D) return;
  S.stackText = $("#stack").value;
  if (!lines(S.stackText).length) { S.checkResults = []; S.checkStatus = "idle"; renderResults(); return; }
  S.checkStatus = "checking";
  renderResults();
  // Deja pintar el skeleton y calcula; dura lo que dure el cruce real.
  requestAnimationFrame(() => setTimeout(() => {
    S.checkResults = check(S.stackText);
    S.checkStatus = "done";
    renderResults();
  }, 0));
}

function checkerHtml() {
  return `${corners}
    <div class="tool-head">
      <span class="tool-ic">${icon("scan-search", 20)}</span>
      <div>
        <div class="kicker">Comprobador</div>
        <h3>¿Qué me afecta?</h3>
        <div class="tool-desc">Pega tu inventario, un producto por línea. Se cruza con el catálogo KEV completo.</div>
      </div>
    </div>
    <div class="field">
      <label for="stack" id="stack-label"></label>
      <textarea id="stack" class="input" rows="5" spellcheck="false" autocomplete="off"></textarea>
    </div>
    <div class="ck-actions">
      <button class="btn btn-primary blueprint" type="button" id="ck-run">${corners}Comprobar exposición</button>
      <button class="btn btn-ghost" type="button" id="ck-example">Usar ejemplo</button>
    </div>
    <div id="ck-out"></div>`;
}

const updateStackLabel = () => { $("#stack-label").textContent = "Inventario · " + fmt(lines($("#stack").value).length) + " líneas"; };

/* =====================================================================
   Asesor IA
   ===================================================================== */
const history = []; // {role, content} para dar continuidad a los seguimientos

/** Texto del modelo → HTML seguro: párrafos, listas numeradas, CVE enlazados a la NVD. */
function fmtAnswer(txt) {
  const inline = s => esc(s)
    // Los CVE ya se enlazan; se quitan las URL de la NVD que el modelo añade detrás.
    .replace(/\s*\(?\s*(?:NVD:\s*)?https?:\/\/nvd\.nist\.gov\/vuln\/detail\/CVE-\d{4}-\d{4,7}\s*\)?/gi, "")
    .replace(/(https?:\/\/[^\s)<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/\b(CVE-\d{4}-\d{4,7})\b(?![^<]*<\/a>)/g, (m, id) => `<a class="cve" href="${nvd(id)}" target="_blank" rel="noopener">${id}</a>`)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^#{1,6}\s*/, "");
  let html = "", list = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of String(txt).split("\n")) {
    const ol = /^\s*(\d+)[.)]\s+(.*)$/.exec(raw), ul = /^\s*[-*•]\s+(.*)$/.exec(raw);
    if (ol || ul) {
      const kind = ol ? "ol" : "ul";
      if (list !== kind) { close(); html += `<${kind} class="msg-list">`; list = kind; }
      html += `<li><span class="n">${ol ? esc(ol[1]) : "–"}</span><span>${inline(ol ? ol[2] : ul[1])}</span></li>`;
    } else {
      close();
      if (raw.trim()) html += `<p>${inline(raw.trim())}</p>`;
    }
  }
  close();
  return html;
}

function msgHtml(m) {
  if (m.role === "user") return `<div class="msg-user">${esc(m.text)}</div>`;
  const body = m.error
    ? `<p class="msg-err">${icon("triangle-alert", 14)}<span>${esc(m.text)}</span></p>`
    : (m.html || fmtAnswer(m.text));
  const src = m.sources && m.sources.length
    ? `<div class="msg-src">Fuentes: ${m.sources.slice(0, 8).map(id => `<a class="cve" href="${nvd(id)}" target="_blank" rel="noopener">${id}</a>`).join(", ")}${m.sources.length > 8 ? " +" + (m.sources.length - 8) : ""}${m.meta ? " · " + esc(m.meta) : ""}</div>`
    : "";
  return `<div class="msg-bot"><div class="msg-who"><span class="sq acc" aria-hidden="true"></span>Asesor</div>${body}${src}</div>`;
}

function renderLog() {
  const log = $("#adv-log");
  log.innerHTML = S.messages.map(msgHtml).join("") + (S.advisorPending ? '<div class="msg-wait">Consultando el catálogo…</div>' : "");
  log.scrollTop = log.scrollHeight;
  $("#adv-send").disabled = S.advisorPending;
  $$("#adv-sugg button").forEach(b => { b.disabled = S.advisorPending; });
  $("#adv-log").setAttribute("aria-busy", S.advisorPending);
}

async function ask(text) {
  const q = (text || "").trim();
  if (!q || S.advisorPending) return;
  S.messages.push({ role: "user", text: q });
  S.draft = ""; $("#adv-q").value = "";
  S.advisorPending = true;
  renderLog();
  try {
    const res = await fetch("/api/advisor", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q, history: history.slice(-6) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) S.messages.push({ role: "bot", error: true, text: data.error || "Error " + res.status });
    else {
      const v = S.catalog.meta ? "catálogo v" + S.catalog.meta.version : "";
      S.messages.push({ role: "bot", text: data.answer, sources: data.sources || [], meta: [v, data.model].filter(Boolean).join(" · ") });
      history.push({ role: "user", content: q }, { role: "assistant", content: data.answer });
    }
  } catch (e) {
    S.messages.push({ role: "bot", error: true, text: "No se pudo contactar con el asesor: " + e.message });
  }
  S.advisorPending = false;
  renderLog();
}

function advisorHtml() {
  return `${corners}
    <div class="tool-head">
      <span class="tool-ic fill">${icon("message-square", 20)}</span>
      <div>
        <div class="kicker">Asesor IA</div>
        <h3>Pregunta al asesor</h3>
        <div class="tool-desc" id="adv-desc">Responde solo con datos del catálogo cargado y cita cada entrada.</div>
      </div>
    </div>
    <div class="adv-log" id="adv-log" role="log" aria-live="polite" aria-label="Conversación con el asesor"></div>
    <div class="adv-sugg" id="adv-sugg">${SUGGESTIONS.map(s => `<button class="btn btn-secondary" type="button">${esc(s)}</button>`).join("")}</div>
    <div class="adv-in">
      <input class="input" id="adv-q" type="text" placeholder="Pregunta sobre el catálogo…" aria-label="Pregunta al asesor" autocomplete="off">
      <button class="btn btn-primary blueprint" type="button" id="adv-send">${corners}${icon("send", 15)}Enviar</button>
    </div>
    <div class="adv-note">${icon("shield", 14)}<span>Uso defensivo: el asesor no genera exploits ni pasos ofensivos. Verifica cada CVE en la NVD y en el aviso del fabricante.</span></div>`;
}

/* ===================================================================== */
export default {
  name: "exposure",
  mount() {
    $("#exposure").innerHTML = `<div class="blueprint tool" id="checker">${checkerHtml()}</div><div class="blueprint tool" id="advisor">${advisorHtml()}</div>`;

    // Comprobador
    S.stackText = DEFAULT_STACK;
    $("#stack").value = S.stackText;
    updateStackLabel();
    $("#stack").addEventListener("input", updateStackLabel);
    $("#ck-run").addEventListener("click", runCheck);
    $("#ck-example").addEventListener("click", () => { $("#stack").value = DEFAULT_STACK; updateStackLabel(); $("#stack").focus(); });
    $("#ck-run").disabled = true;

    // Asesor
    S.messages = [{ role: "bot", html: "<p>Pregúntame por un CVE, un fabricante o un producto. Respondo con los registros reales del catálogo CISA KEV: productos afectados, uso en ransomware, plazos de corrección y prioridad.</p>" }];
    renderLog();
    $("#adv-sugg").addEventListener("click", e => { const b = e.target.closest("button"); if (b) ask(b.textContent); });
    $("#adv-send").addEventListener("click", () => ask($("#adv-q").value));
    $("#adv-q").addEventListener("input", e => { S.draft = e.target.value; });
    $("#adv-q").addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); ask(S.draft); } });
    fetch("/api/health").then(r => r.json()).then(h => {
      if (!h.advisor) {
        S.messages.push({ role: "bot", error: true, text: "El asesor IA no está configurado en el servidor: añade la clave del proveedor al archivo .env y reinicia." });
        renderLog();
      }
    }).catch(() => {});
  },
  skeleton() {
    $("#ck-run").disabled = true;
    $("#ck-out").innerHTML = `<div class="ck-loading" aria-busy="true"><div class="sk" style="opacity:.7"></div><div class="sk" style="opacity:.5"></div><div class="sk" style="opacity:.3"></div></div>`;
  },
  unavailable() { $("#ck-out").innerHTML = ""; },
  render() {
    $("#ck-run").disabled = false;
    $("#adv-desc").textContent = `Responde solo con datos del catálogo cargado (v${S.catalog.meta.version || "—"}) y cita cada entrada.`;
    if (S.checkStatus === "idle" || S.checkStatus === "done") runCheck();
  },
};

