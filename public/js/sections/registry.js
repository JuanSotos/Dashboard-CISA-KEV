/* 04 · Registro — buscador, filtros (AND), tabla ordenable con cabecera sticky
   y lista de tarjetas cuando el contenedor mide menos de 720 px. */
import { $, esc, fmt, corners, dueStatus, flags, tag } from "../util.js";
import { icon } from "../icons.js";
import { S, D, R } from "../data.js";

const NARROW = 720;
const COLS = [
  { key: "cve", label: "CVE", w: "150px" },
  { key: "vendor", label: "Fabricante / producto", w: "200px" },
  { key: "name", label: "Vulnerabilidad", w: "auto", fixed: true },
  { key: "added", label: "Añadida", w: "120px" },
  { key: "due", label: "Plazo", w: "140px" },
  { key: "flags", label: "Marcas", w: "190px", fixed: true },
];
const cmp = {
  cve: (a, b) => a.cveKey - b.cveKey,
  vendor: (a, b) => a.vendor.localeCompare(b.vendor, "es") || a.product.localeCompare(b.product, "es"),
  added: (a, b) => a.added.localeCompare(b.added),
  due: (a, b) => (a.due || "9999").localeCompare(b.due || "9999"),
};

function filtered() {
  const q = S.query.trim().toLowerCase();
  const rows = D.rows.filter(r => (!S.filterRansomware || r.rw) && (!S.filterOverdue || r.isOverdue) &&
    (!S.vendorFilter || r.vendor === S.vendorFilter) && (!q || r.hay.includes(q)));
  const f = cmp[S.sort.key], dir = S.sort.dir;
  return rows.sort((a, b) => f(a, b) * dir || b.cveKey - a.cveKey);
}

function thHtml(c) {
  if (c.fixed) return `<th scope="col" style="width:${c.w}">${c.label}</th>`;
  const active = S.sort.key === c.key, asc = S.sort.dir === 1;
  const ic = active ? icon(asc ? "arrow-up" : "arrow-down", 12, { sw: 1.75 }) : icon("chevrons-up-down", 12, { cls: "idle" });
  return `<th scope="col" style="width:${c.w}" aria-sort="${active ? (asc ? "ascending" : "descending") : "none"}">
    <button type="button" class="sort${active ? " on" : ""}" data-sort="${c.key}">${c.label}${ic}</button></th>`;
}

function tableHtml(rows) {
  return `<div class="blueprint">${corners}<div class="reg-scroll" tabindex="0" role="region" aria-label="Registro de vulnerabilidades">
    <table class="table reg-table">
      <thead><tr>${COLS.map(thHtml).join("")}</tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td class="nw"><a class="cve ext" href="${r.url}" target="_blank" rel="noopener">${r.cve}${icon("arrow-up-right", 12)}<span class="sr-only"> (abre la NVD en una pestaña nueva)</span></a></td>
        <td><div class="v">${esc(r.vendor)}</div><div class="sub">${esc(r.product)}</div></td>
        <td class="pretty">${esc(r.name)}</td>
        <td class="nw">${r.addedLabel}</td>
        <td class="nw"><div>${r.dueLabel}</div>${r.isOverdue || r.isSoon ? `<div class="due">${dueStatus(r, "table")}</div>` : ""}</td>
        <td><div class="flags">${r.rw || r.fx ? flags(r, true) : '<span class="muted">—</span>'}</div></td>
      </tr>`).join("")}</tbody>
    </table></div></div>`;
}

function cardsHtml(rows) {
  return `<ul class="reg-cards" aria-label="Registro de vulnerabilidades">${rows.map(r => `<li>
    <div class="c-top"><a class="cve" href="${r.url}" target="_blank" rel="noopener">${r.cve}</a><span class="sub">Añadida ${r.addedShort}</span></div>
    <div class="sub">${esc(r.vendor)} · ${esc(r.product)}</div>
    <div class="c-name">${esc(r.name)}</div>
    <div class="c-tags">${dueStatus(r)}${r.rw ? tag.rw(false) : ""}${r.fx ? tag.fx(false) : ""}</div>
  </li>`).join("")}</ul>`;
}

function emptyHtml() {
  return `<div class="blueprint empty">${corners}${icon("search", 28)}
    <div class="empty-title">Sin resultados</div>
    <div class="empty-text">Ninguna entrada coincide con la búsqueda y los filtros activos.</div>
    <button class="btn btn-secondary" type="button" id="reg-clear">Limpiar filtros</button></div>`;
}

function renderToolbar() {
  $("#chip-rw").setAttribute("aria-pressed", S.filterRansomware);
  $("#chip-over").setAttribute("aria-pressed", S.filterOverdue);
  const q = $("#reg-q");
  if (q.value !== S.query) q.value = S.query;
  $("#chip-vendor").innerHTML = S.vendorFilter
    ? `<button type="button" class="chip" aria-pressed="true" id="clear-vendor" aria-label="Quitar filtro de fabricante: ${esc(S.vendorFilter)}">Fabricante: ${esc(S.vendorFilter)}${icon("x", 13)}</button>`
    : "";
}

function renderBody() {
  const rows = filtered();
  $("#reg-count").textContent = "Mostrando " + fmt(rows.length) + " de " + fmt(D.rows.length);
  // Conserva el scroll horizontal/vertical de la tabla al reordenar.
  const prev = $("#reg-body .reg-scroll");
  const pos = prev ? [prev.scrollLeft, prev.scrollTop] : null;
  $("#reg-body").innerHTML = !rows.length ? emptyHtml() : S.narrow ? cardsHtml(rows) : tableHtml(rows);
  const next = $("#reg-body .reg-scroll");
  if (next && pos) [next.scrollLeft, next.scrollTop] = pos;
}

function render() { if (!D) return; renderToolbar(); renderBody(); }

function clearAll() {
  Object.assign(S, { vendorFilter: null, query: "", filterRansomware: false, filterOverdue: false });
  render(); R.risk?.();
}

export default {
  name: "registry",
  mount() {
    const box = $("#registry");
    box.innerHTML = `<div class="reg-bar">
        <div class="reg-search">${icon("search", 15)}
          <input class="input" id="reg-q" type="search" placeholder="Buscar CVE, fabricante o producto" aria-label="Buscar en el registro" autocomplete="off"></div>
        <button type="button" class="chip" id="chip-rw" aria-pressed="false">${icon("lock", 13)}Ransomware</button>
        <button type="button" class="chip" id="chip-over" aria-pressed="false">${icon("clock", 13)}Vencidas</button>
        <span id="chip-vendor"></span>
        <span class="reg-count" id="reg-count" aria-live="polite"></span>
      </div>
      <div id="reg-body"></div>`;

    let t;
    $("#reg-q").addEventListener("input", e => { S.query = e.target.value; clearTimeout(t); t = setTimeout(() => D && renderBody(), 120); });
    $("#chip-rw").addEventListener("click", () => { S.filterRansomware = !S.filterRansomware; render(); });
    $("#chip-over").addEventListener("click", () => { S.filterOverdue = !S.filterOverdue; render(); });
    box.addEventListener("click", e => {
      if (e.target.closest("#clear-vendor")) { S.vendorFilter = null; render(); R.risk?.(); $("#reg-q").focus(); return; }
      if (e.target.closest("#reg-clear")) { clearAll(); $("#reg-q").focus(); return; }
      const b = e.target.closest("button[data-sort]");
      if (b) {
        const k = b.dataset.sort;
        S.sort = S.sort.key === k ? { key: k, dir: -S.sort.dir } : { key: k, dir: 1 };
        renderBody();
        $(`#reg-body button[data-sort="${k}"]`)?.focus();
      }
    });

    // Tabla ≥ 720 px de contenedor; tarjetas por debajo.
    new ResizeObserver(([e]) => {
      const n = e.contentRect.width < NARROW;
      if (n !== S.narrow) { S.narrow = n; if (D) renderBody(); }
    }).observe(box);
  },
  skeleton() {
    $("#reg-body").innerHTML = `<div class="blueprint" aria-busy="true">${corners}<div style="padding:14px;display:flex;flex-direction:column;gap:12px">
      ${'<div class="sk" style="height:34px"></div>'.repeat(6)}</div></div>`;
  },
  unavailable() { $("#reg-body").innerHTML = ""; $("#reg-count").textContent = ""; },
  render,
};
