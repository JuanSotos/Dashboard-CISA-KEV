/* Estado de la aplicación y derivados del catálogo CISA KEV.
   El catálogo llega de /api/kev (el servidor lo descarga de CISA y lo cachea). */
import { ts, todayUTC, DAY, nvd, fdate, fshort } from "./util.js";

export const S = {
  theme: document.documentElement.getAttribute("data-theme") || "light",
  catalog: { records: [], meta: null, fetchedAt: null, status: "loading", error: null }, // loading|live|refreshing|offline
  seriesMode: "monthly",           // monthly | cumulative
  hoverMonth: -1,
  hoverCwe: -1,
  vendorFilter: null,
  query: "",
  filterRansomware: false,
  filterOverdue: false,
  sort: { key: "due", dir: 1 },
  stackText: "",
  checkStatus: "idle",             // idle | checking | done
  checkResults: [],
  messages: [],
  draft: "",
  advisorPending: false,
  narrow: false,
};

/** Renderizadores por sección (los rellena app.js) para que una sección repinte otra. */
export const R = {};

/** Datos derivados; se recalculan cada vez que llega el catálogo. */
export let D = null;

export async function fetchCatalog(refresh) {
  const res = await fetch("/api/kev" + (refresh ? "?refresh=1" : ""));
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || body.error || "HTTP " + res.status);
  return body;
}

// Ventana de "Urgente hoy": con datos reales casi todo el catálogo tiene el plazo
// superado (CISA fija el plazo 2–3 semanas después del alta), así que la sección 00
// solo cuenta como vencidas las que vencieron en los últimos 30 días.
export const URGENT_WINDOW = 30;

// Fórmula del README, con "vencida" = vencida dentro de la ventana.
const priorityScore = r => (r.recentOverdue ? 1000 + -r.left : 0) + (r.rw ? 500 : 0) + (r.isSoon ? 300 - r.left : 0) + (r.fx ? 50 : 0);

export function derive(data) {
  const today = todayUTC();
  const rows = data.records.map(v => {
    const left = v.due ? Math.round((ts(v.due) - today) / DAY) : null;
    const isOverdue = left !== null && left < 0;
    const isSoon = left !== null && left >= 0 && left <= 7;
    return {
      cve: v.id, vendor: v.v, product: v.p, name: v.n, added: v.a, due: v.due, rw: !!v.r, fx: !!v.f,
      cwes: v.w || [], desc: v.d || "", left, isOverdue, isSoon,
      recentOverdue: isOverdue && -left <= URGENT_WINDOW,
      url: nvd(v.id), addedLabel: fdate(v.a), addedShort: fshort(v.a), dueLabel: v.due ? fdate(v.due) : "—",
      ageDays: (today - ts(v.a)) / DAY,
      // Orden numérico del CVE: año y secuencia
      cveKey: (() => { const m = /CVE-(\d+)-(\d+)/.exec(v.id); return m ? +m[1] * 1e8 + +m[2] : 0; })(),
      hay: (v.id + " " + v.v + " " + v.p + " " + v.n).toLowerCase(),
    };
  });
  const N = rows.length;

  // 00 · Urgente hoy
  const urgentSet = rows.filter(r => r.recentOverdue || r.isSoon);
  const queue = urgentSet
    .map(r => ({ r, s: priorityScore(r) }))
    .sort((a, b) => b.s - a.s || b.r.added.localeCompare(a.r.added))
    .slice(0, 5).map(x => x.r);
  const urgent = {
    overdue: rows.filter(r => r.recentOverdue).length,
    soon: rows.filter(r => r.isSoon).length,
    rw30: rows.filter(r => r.rw && r.ageDays <= 30).length,
    queue,
  };

  // 01 · KPIs
  const rwN = rows.filter(r => r.rw).length;
  const vendorMap = new Map();
  for (const r of rows) {
    const e = vendorMap.get(r.vendor) || { name: r.vendor, count: 0, rw: 0 };
    e.count++; if (r.rw) e.rw++;
    vendorMap.set(r.vendor, e);
  }
  const vendors = [...vendorMap.values()].sort((a, b) => b.count - a.count);
  const firstAdded = rows.reduce((m, r) => (r.added < m ? r.added : m), rows[0]?.added || "");
  const kpis = {
    total: N, since: firstAdded,
    added30: rows.filter(r => r.ageDays <= 30).length,
    avg12: rows.filter(r => r.ageDays < 365).length / 12,
    rwN, rwPct: N ? rwN / N * 100 : 0,
    fxN: rows.filter(r => r.fx).length,
    vendorsN: vendors.length, topVendor: vendors[0], topVendorPct: N && vendors[0] ? vendors[0].count / N * 100 : 0,
  };

  // Serie mensual de los últimos 36 meses + el mes en curso (oct 2023 – oct 2026)
  const t = new Date(today);
  const endY = t.getUTCFullYear(), endM = t.getUTCMonth();
  const months = [];
  for (let i = 36; i >= 0; i--) {
    const d = new Date(Date.UTC(endY, endM - i, 1));
    months.push({ y: d.getUTCFullYear(), m: d.getUTCMonth(), key: d.toISOString().slice(0, 7), added: 0, cum: 0 });
  }
  const startKey = months[0].key;
  const byMonth = new Map(months.map(mo => [mo.key, mo]));
  let base = 0;
  for (const r of rows) {
    const k = r.added.slice(0, 7);
    if (k < startKey) base++;
    else if (byMonth.has(k)) byMonth.get(k).added++;
  }
  let acc = base;
  for (const mo of months) { acc += mo.added; mo.cum = acc; }

  // Altas por año
  const yearMap = new Map();
  for (const r of rows) { const y = r.added.slice(0, 4); yearMap.set(y, (yearMap.get(y) || 0) + 1); }
  const years = [...yearMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([year, count]) => ({ year, count, partial: +year === endY }));

  // 02 · CWE: se cuenta el CWE principal de cada entrada (el primero), así los segmentos suman el total.
  const cweMap = new Map();
  let noCwe = 0;
  for (const r of rows) {
    const c = r.cwes.find(x => /^CWE-\d+$/.test(x));
    if (!c) { noCwe++; continue; }
    cweMap.set(c, (cweMap.get(c) || 0) + 1);
  }
  const cweTop = [...cweMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const cweTopSum = cweTop.reduce((s, x) => s + x[1], 0);
  const cwe = [...cweTop.map(([id, count]) => ({ id, name: CWE_NAMES[id] || "", count })),
    { id: "Otros", name: "Resto y sin CWE", count: N - cweTopSum }];

  return { today, rows, urgent, kpis, months, years, cwe, vendors, vendorsTop: vendors.slice(0, 8), noCwe };
}

export function setDerived(d) { D = d; }

const CWE_NAMES = {
  "CWE-20": "Validación de entrada", "CWE-22": "Path traversal", "CWE-77": "Inyección de comandos",
  "CWE-78": "Inyección de comandos SO", "CWE-79": "Cross-site scripting", "CWE-89": "Inyección SQL",
  "CWE-94": "Inyección de código", "CWE-119": "Error de búfer", "CWE-120": "Desbordamiento de búfer",
  "CWE-122": "Desbordamiento de montículo", "CWE-125": "Lectura fuera de límites", "CWE-190": "Desbordamiento de entero",
  "CWE-200": "Exposición de información", "CWE-269": "Gestión de privilegios", "CWE-284": "Control de acceso",
  "CWE-287": "Autenticación incorrecta", "CWE-288": "Omisión de autenticación", "CWE-306": "Falta de autenticación",
  "CWE-352": "CSRF", "CWE-362": "Condición de carrera", "CWE-400": "Consumo de recursos",
  "CWE-416": "Uso tras liberación", "CWE-434": "Subida de ficheros", "CWE-476": "Puntero nulo",
  "CWE-502": "Deserialización insegura", "CWE-611": "Entidades XML externas", "CWE-668": "Exposición de recursos",
  "CWE-704": "Conversión de tipos", "CWE-732": "Permisos incorrectos", "CWE-787": "Escritura fuera de límites",
  "CWE-798": "Credenciales embebidas", "CWE-843": "Confusión de tipos", "CWE-862": "Falta de autorización",
  "CWE-863": "Autorización incorrecta", "CWE-918": "SSRF",
};
