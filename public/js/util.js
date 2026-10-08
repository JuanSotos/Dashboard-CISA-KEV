/* Utilidades de formato (es-ES), fechas en UTC y fragmentos de marcado comunes. */
import { icon } from "./icons.js";

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// es-ES no agrupa los números de 4 cifras ("1712"), así que los miles se agrupan a mano.
export const fmt = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
export const pct = (x, d = 1) => x.toFixed(d).replace(".", ",") + " %";

export const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const MES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
export const DAY = 86400000;

/** "2026-10-01" → timestamp UTC a medianoche. */
export const ts = s => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d); };
export const todayUTC = () => { const n = new Date(); return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()); };
/** "01 oct 2026" */
export const fdate = s => { const t = new Date(ts(s)); return String(t.getUTCDate()).padStart(2, "0") + " " + MES[t.getUTCMonth()] + " " + t.getUTCFullYear(); };
/** "1 oct" */
export const fshort = s => { const t = new Date(ts(s)); return t.getUTCDate() + " " + MES[t.getUTCMonth()]; };
/** "Jueves 9 oct 2026" */
export const flong = t => { const d = new Date(t); return DIA[d.getUTCDay()] + " " + d.getUTCDate() + " " + MES[d.getUTCMonth()] + " " + d.getUTCFullYear(); };

/** "hace unos segundos" / "hace 4 min" / "hace 2 h" / "hace 3 d" */
export function ago(iso) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 60000));
  if (mins < 1) return "hace unos segundos";
  if (mins < 60) return "hace " + mins + " min";
  const h = Math.floor(mins / 60);
  if (h < 48) return "hace " + h + " h";
  return "hace " + Math.floor(h / 24) + " d";
}

export const nvd = cve => "https://nvd.nist.gov/vuln/detail/" + cve;
export const corners = '<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>';

/* ---------- Etiquetas de severidad (siempre con texto; icono donde procede) ---------- */
export const tag = {
  rw: (withIcon = true, small = false) => `<span class="tag tag-rw">${withIcon ? icon("lock", small ? 10 : 11, { sw: small ? 2 : 1.75 }) : ""}RANSOMWARE</span>`,
  fx: (withIcon = true, small = false) => `<span class="tag tag-fx">${withIcon ? icon("search", small ? 10 : 11, { sw: small ? 2 : 1.75 }) : ""}FORENSE</span>`,
};

/**
 * Estado del plazo: VENCIDA + "hace N d", VENCE HOY / VENCE EN N D, o "Plazo 23 oct".
 * `ctx`: "queue" (con icono de reloj), "table" (sin texto para > 7 d) o "inline".
 */
export function dueStatus(r, ctx = "inline") {
  if (!r.due) return ctx === "table" ? "" : '<span class="muted">Sin plazo</span>';
  if (r.left < 0) return `<span class="due-over"><span class="tag tag-over">VENCIDA</span>hace ${fmt(-r.left)} d</span>`;
  if (r.left <= 7) {
    const txt = r.left === 0 ? "VENCE HOY" : "VENCE EN " + r.left + " D";
    return `<span class="tag tag-soon">${ctx === "queue" ? icon("clock", 11, { sw: 1.75 }) : ""}${txt}</span>`;
  }
  return ctx === "table" ? "" : `<span class="muted">Plazo ${fshort(r.due)}</span>`;
}

export const flags = (r, small) => (r.rw ? tag.rw(true, small) : "") + (r.fx ? tag.fx(true, small) : "");
