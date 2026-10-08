/**
 * KEV Advisor — servidor backend (proxy).
 *
 * Responsabilidades:
 *   1. Descargar EN VIVO el catálogo oficial CISA KEV (con caché y revalidación).
 *      El navegador nunca llama a CISA directamente (evita CORS y centraliza la caché).
 *   2. Exponer el asesor de ciberseguridad por IA. La API key del modelo vive SOLO
 *      aquí, en el servidor — nunca se envía al navegador (buena práctica de seguridad).
 *
 * Proveedores de IA soportados: Groq (por defecto, rápido y gratis) y OpenRouter.
 *
 * Arranque:  npm install  &&  npm run dev   ->   http://localhost:3000
 */
"use strict";

require("dotenv").config();
const path = require("path");
const express = require("express");

const app = express();
app.use(express.json({ limit: "512kb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora (CISA actualiza ~1 vez al día)

// Limpia una API key: quita comillas, espacios y saltos de línea (frecuentes al pegar).
const cleanKey = k => (k || "").trim().replace(/^["']|["']$/g, "").replace(/\s/g, "");

// ----------------------------------------------------------------------------
// Configuración del proveedor de IA
// ----------------------------------------------------------------------------
const PROVIDER = (process.env.LLM_PROVIDER || "groq").toLowerCase();
const GROQ_KEY = cleanKey(process.env.GROQ_API_KEY);
const OR_KEY = cleanKey(process.env.OPENROUTER_API_KEY);
const OR_MODEL_PREF = (process.env.OPENROUTER_MODEL || "auto").trim();

const PROVIDERS = {
  groq: {
    name: "Groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    key: GROQ_KEY,
    // Modelos a probar en orden (si uno está retirado, pasa al siguiente).
    models: (process.env.GROQ_MODEL || "llama-3.3-70b-versatile,llama-3.1-8b-instant").split(",").map(s => s.trim()).filter(Boolean),
    keysUrl: "https://console.groq.com/keys",
    envVar: "GROQ_API_KEY",
  },
  openrouter: {
    name: "OpenRouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    key: OR_KEY,
    models: null, // se resuelve en runtime (auto o fijado)
    keysUrl: "https://openrouter.ai/keys",
    envVar: "OPENROUTER_API_KEY",
  },
};
const cfg = () => PROVIDERS[PROVIDER] || PROVIDERS.groq;

// --- Autoselección de modelo según lo que la clave PUEDE usar de verdad ----
// Groq y OpenRouter exponen /models; elegimos de esa lista para no pedir nunca
// un modelo inexistente o sin acceso para esta cuenta.
// Preferimos modelos NO de razonamiento (rápidos, sin fugas de "thinking" y con mejor
// límite de tokens/min en la capa gratuita). Los de razonamiento (qwen3, deepseek-r1) al final.
const GROQ_RANK = ["llama-3.3-70b", "llama-3.1-70b", "llama-3.2-90b", "llama-3.1-8b", "llama3-70b", "llama3-8b", "gemma2", "gemma", "gpt-oss-20b", "gpt-oss-120b", "gpt-oss", "mixtral", "qwen3", "qwen", "deepseek"];
const GROQ_BAD = /whisper|tts|guard|embed|moderation|vision-preview/i;
const OR_RANK = [
  "deepseek/deepseek-chat", "deepseek/deepseek-r1", "meta-llama/llama-3.3-70b", "meta-llama/llama-3.1-70b",
  "qwen/qwen-2.5-72b", "qwen/qwq", "google/gemini-2.0-flash", "google/gemma-3-27b",
  "mistralai/mistral-small", "meta-llama/llama-3.1-8b", "microsoft/phi",
];
const OR_PREF_ORGS = ["deepseek", "meta-llama", "qwen", "google", "mistralai", "microsoft", "nvidia"];
let modelListCache = { at: 0, provider: null, data: null };

async function listModels(c) {
  const now = Date.now();
  if (modelListCache.data && modelListCache.provider === PROVIDER && now - modelListCache.at < CACHE_TTL_MS) return modelListCache.data;
  const url = c.url.replace("/chat/completions", "/models");
  const r = await fetch(url, { headers: { "Authorization": "Bearer " + c.key } });
  if (!r.ok) throw new Error("No se pudo listar modelos (HTTP " + r.status + ")");
  const data = (await r.json()).data || [];
  modelListCache = { at: now, provider: PROVIDER, data };
  return data;
}

// Devuelve la lista ordenada de modelos a intentar para el proveedor activo.
async function modelsToTry() {
  const c = cfg();
  if (PROVIDER === "openrouter") {
    if (OR_MODEL_PREF && OR_MODEL_PREF.toLowerCase() !== "auto") return [OR_MODEL_PREF];
    const free = (await listModels(c)).filter(m => {
      const p = m.pricing || {};
      return Number(p.prompt) === 0 && Number(p.completion) === 0 &&
        /instruct|chat|:free|-it\b|gemini|deepseek|qwen|llama|mistral|gemma/i.test(m.id);
    }).map(m => m.id);
    free.sort((a, b) => {
      const rk = id => { const i = OR_RANK.findIndex(s => id.toLowerCase().includes(s)); return i >= 0 ? i : (OR_PREF_ORGS.includes(id.split("/")[0].toLowerCase()) ? 100 : 500); };
      return rk(a) - rk(b);
    });
    if (!free.length) throw new Error("OpenRouter no ofrece ahora mismo ningún modelo gratuito compatible");
    return free.slice(0, 3);
  }
  // Groq (u otro OpenAI-compatible): elegir de los modelos accesibles para la clave.
  let ids;
  try { ids = (await listModels(c)).map(m => m.id); }
  catch (e) { return c.models; } // si no se puede listar, usar los del .env como último recurso
  const pinned = c.models.filter(m => ids.includes(m)); // respeta GROQ_MODEL si existe
  const ranked = ids.filter(id => !GROQ_BAD.test(id)).sort((a, b) => {
    const rk = id => { const i = GROQ_RANK.findIndex(s => id.toLowerCase().includes(s)); return i < 0 ? 999 : i; };
    return rk(a) - rk(b);
  });
  const out = [...new Set([...pinned, ...ranked])];
  if (!out.length) throw new Error("La clave no tiene acceso a ningún modelo de chat");
  return out.slice(0, 4);
}

// ----------------------------------------------------------------------------
// Caché del catálogo CISA KEV
// ----------------------------------------------------------------------------
const KEV_SOURCES = [
  "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
  "https://raw.githubusercontent.com/cisagov/kev-data/develop/known_exploited_vulnerabilities.json",
];
let cache = { data: null, fetchedAt: 0, source: null };

function trim(v) {
  return {
    id: v.cveID, v: v.vendorProject, p: v.product, n: v.vulnerabilityName,
    a: v.dateAdded, due: v.dueDate || "",
    r: v.knownRansomwareCampaignUse === "Known" ? 1 : 0,
    f: v.forensicTriage === "Yes" ? 1 : 0,
    w: v.cwes || [], d: v.shortDescription || "",
  };
}

async function fetchCatalog() {
  let lastErr;
  for (const url of KEV_SOURCES) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "KEV-Advisor/1.0 (+local)" } });
      clearTimeout(to);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const raw = await res.json();
      const records = (raw.vulnerabilities || []).map(trim);
      return {
        meta: {
          title: raw.title || "CISA Known Exploited Vulnerabilities",
          version: raw.catalogVersion || "", released: (raw.dateReleased || "").slice(0, 10), count: records.length,
        },
        records, source: url,
      };
    } catch (e) { lastErr = e; console.warn("[kev] fuente falló:", url, "->", e.message); }
  }
  throw lastErr || new Error("No se pudo descargar el catálogo");
}

async function getCatalog(force) {
  const fresh = Date.now() - cache.fetchedAt < CACHE_TTL_MS;
  if (cache.data && fresh && !force) return cache;
  const data = await fetchCatalog();
  cache = { data, fetchedAt: Date.now(), source: data.source };
  return cache;
}

app.get("/api/kev", async (req, res) => {
  try {
    const c = await getCatalog(req.query.refresh === "1");
    res.json({ ...c.data, fetchedAt: new Date(c.fetchedAt).toISOString(), source: c.source });
  } catch (e) {
    res.status(502).json({ error: "No se pudo obtener el catálogo CISA KEV", detail: e.message });
  }
});

// ----------------------------------------------------------------------------
// Recuperación tipo RAG
// ----------------------------------------------------------------------------
const STOP = new Set("de la el en y a los las un una que con por para es son del al sobre como cve cves vulnerabilidad vulnerabilidades exploit exploits ransomware afecta afectan producto productos fabricante debo priorizar como me protejo dame hay".split(" "));

function retrieve(question, records, limit = 14) {
  const q = question.toLowerCase();
  const cveIds = (question.toUpperCase().match(/CVE-\d{4}-\d{4,7}/g) || []);
  const tokens = q.replace(/[^\p{L}\p{N}\s.-]/gu, " ").split(/\s+/).filter(t => t.length >= 3 && !STOP.has(t));
  const wantRansom = /ransom/.test(q);
  const scored = records.map(r => {
    let s = 0;
    const hay = (r.id + " " + r.v + " " + r.p + " " + r.n + " " + r.w.join(" ")).toLowerCase();
    if (cveIds.includes(r.id)) s += 100;
    for (const t of tokens) if (hay.includes(t)) s += 2;
    if (wantRansom && r.r) s += 1.5;
    return { r, s };
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit);
  return scored.map(x => x.r);
}

function contextBlock(recs) {
  if (!recs.length) return "(sin coincidencias en el catálogo para esta consulta)";
  return recs.map(r =>
    `- ${r.id} | ${r.v} ${r.p} | añadida ${r.a}${r.due ? ", plazo " + r.due : ""}` +
    `${r.r ? " | USO EN RANSOMWARE: sí" : ""}${r.w.length ? " | CWE " + r.w.join(",") : ""}\n` +
    `  ${r.n}. ${r.d}\n  NVD: https://nvd.nist.gov/vuln/detail/${r.id}`
  ).join("\n");
}

const SYSTEM_PROMPT = `Eres un asesor de ciberseguridad especializado en gestión de vulnerabilidades, integrado en el panel "KEV Advisor". Trabajas SOLO con el catálogo oficial CISA KEV (vulnerabilidades explotadas de forma conocida).

Reglas estrictas:
- RESPONDE SIEMPRE EN ESPAÑOL, sea cual sea el idioma de la pregunta.
- Entrega SOLO la respuesta final para el analista. NO muestres tu razonamiento, cadenas de pensamiento, notas internas ni texto en inglés. Nada de "thinking process".
- Usa el CONTEXTO de registros reales proporcionado. Si el contexto no contiene nada relevante, dilo con una frase y sugiere reformular; no inventes CVEs ni datos.
- Enfoque DEFENSIVO: prioriza remediación, parcheo, productos afectados, plazos (BOD), detección y mitigación. NO des código de explotación ni pasos ofensivos; si te lo piden, recházalo y reconduce a la defensa.
- Cuando cites un CVE, añade su enlace NVD (https://nvd.nist.gov/vuln/detail/CVE-XXXX-XXXX).
- Prioriza por: uso en ransomware, plazo BOD más próximo y criticidad (RCE/escalada de privilegios). Sé conciso y accionable; usa listas cortas.
- Termina SIEMPRE con: "Información orientativa basada en el catálogo CISA KEV; no sustituye una evaluación profesional."`;

// Quita fugas de "razonamiento" por si el modelo las incluyera.
function sanitize(txt) {
  return (txt || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\|?(?:begin|start)[^>]*>|<\|?end[^>]*>/gi, "")
    .replace(/^\s*(?:here'?s?\s+(?:a|my)\s+thinking[\s\S]*?)(?=\n\s*\n)/i, "")
    .trim() || "(sin respuesta)";
}

// Una llamada al proveedor con un modelo concreto.
async function callOnce(c, model, messages) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 60000);
  try {
    const headers = { "Authorization": "Bearer " + c.key, "Content-Type": "application/json" };
    if (PROVIDER === "openrouter") { headers["HTTP-Referer"] = "http://localhost:" + PORT; headers["X-Title"] = "KEV Advisor"; }
    const r = await fetch(c.url, {
      method: "POST", signal: ctrl.signal, headers,
      body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 640 }),
    });
    const data = await r.json();
    return { ok: r.ok, status: r.status, data };
  } finally { clearTimeout(to); }
}

const modelGone = d => /unavailable for free|is not a valid model|no endpoints found|does not exist|decommission|model_not_found|not supported/i.test(JSON.stringify(d && d.error || ""));
// Límite de la capa gratuita (tokens/peticiones por minuto): probar con otro modelo (otra cuota).
const rateLimited = out => out.status === 429 || /rate.?limit|OTPM|TPM|RPM|too many requests|quota/i.test(JSON.stringify(out.data && out.data.error || ""));

// ----------------------------------------------------------------------------
// POST /api/advisor  — asesor IA anclado al catálogo (con seguimiento)
// ----------------------------------------------------------------------------
app.post("/api/advisor", async (req, res) => {
  const body = req.body || {};
  const question = (body.question || "").toString().trim();
  if (!question) return res.status(400).json({ error: "Falta la pregunta." });
  // Historial breve del chat (para seguimientos como "respóndeme en español").
  const history = Array.isArray(body.history)
    ? body.history.filter(m => m && (m.role === "user" || m.role === "assistant") && m.content).slice(-6)
    : [];

  const c = cfg();
  if (!c.key) {
    return res.status(503).json({
      error: `El asesor IA no está configurado (o la clave quedó vacía). Crea una clave gratuita en ${c.keysUrl} y ponla en el archivo .env como: ${c.envVar}=... (en una sola línea, sin comillas).`,
    });
  }

  // El contexto se recupera usando esta pregunta + las últimas del usuario,
  // para que un seguimiento ("respóndeme en español") no pierda el tema.
  let recs = [];
  try {
    const cat = await getCatalog(false);
    const prevUser = history.filter(m => m.role === "user").slice(-2).map(m => m.content).join(" ");
    recs = retrieve((prevUser + " " + question).trim(), cat.data.records);
  } catch (e) {
    return res.status(502).json({ error: "No se pudo cargar el catálogo para dar contexto al asesor." });
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) })),
    { role: "user", content: `Pregunta del analista:\n${question}\n\nCONTEXTO (registros reales del catálogo CISA KEV):\n${contextBlock(recs)}` },
  ];

  try {
    const models = await modelsToTry();
    let out, usedModel, lastErr = "", wasRL = false;
    for (const model of models) {
      usedModel = model;
      out = await callOnce(c, model, messages);
      if (out.ok) break;
      lastErr = (out.data && out.data.error && (out.data.error.message || out.data.error)) || ("HTTP " + out.status);
      wasRL = rateLimited(out);
      if (!modelGone(out.data) && !wasRL) break; // error no reintentable: no insistas
      // modelo retirado o con límite alcanzado → probar el siguiente (otra cuota)
    }
    if (!out || !out.ok) {
      const msg = wasRL
        ? "Límite de la capa gratuita alcanzado (tokens por minuto). Espera unos segundos y reinténtalo; el servidor ya probó modelos alternativos."
        : "Error del modelo: " + lastErr;
      return res.status(502).json({ error: msg });
    }
    const raw = out.data.choices && out.data.choices[0] && out.data.choices[0].message && out.data.choices[0].message.content;
    res.json({ answer: sanitize(raw), sources: recs.map(r => r.id), model: usedModel, provider: c.name });
  } catch (e) {
    const msg = /aborted/i.test(e.message) ? "La consulta tardó demasiado; inténtalo de nuevo." : e.message;
    res.status(502).json({ error: "No se pudo contactar con el proveedor de IA: " + msg });
  }
});

app.get("/api/health", async (req, res) => {
  const c = cfg();
  let model = (c.models && c.models[0]) || OR_MODEL_PREF || "auto";
  if (c.key) {
    try { model = (await modelsToTry())[0]; } catch (e) { model += " (pendiente)"; }
  }
  res.json({ ok: true, provider: c.name, model, advisor: !!c.key });
});

app.listen(PORT, () => {
  const c = cfg();
  console.log(`\n  KEV Advisor en marcha  ->  http://localhost:${PORT}`);
  console.log(`  Proveedor IA: ${c.name} · ${c.key ? "configurado" : "SIN configurar (.env) — el panel funciona igual"}\n`);
});
