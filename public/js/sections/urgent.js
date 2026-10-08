/* 00 · Urgente hoy — tres cifras y cola de prioridad. */
import { $, esc, fmt, flong, corners, dueStatus, flags } from "../util.js";
import { icon } from "../icons.js";
import { S, D, R, URGENT_WINDOW } from "../data.js";

const box = () => $("#urgent");

function figure(n, cls, ic, label, desc, last) {
  return `<div class="u-fig${last ? " last" : ""}">
    <span class="u-num ${cls}">${fmt(n)}</span>
    <div><div class="u-label ${cls}">${icon(ic, 15)}${label}</div><div class="sub">${desc}</div></div>
  </div>`;
}

function queueRow(r, i) {
  return `<li class="q-row">
    <span class="q-rank">${String(i + 1).padStart(2, "0")}</span>
    <div class="q-main">
      <div class="q-id"><a class="cve" href="${r.url}" target="_blank" rel="noopener">${r.cve}</a><span class="sub">${esc(r.vendor)} · ${esc(r.product)}</span></div>
      <div class="q-name">${esc(r.name)}</div>
    </div>
    <div class="q-side">${dueStatus(r, "queue")}${r.rw || r.fx ? `<div class="q-flags">${flags(r)}</div>` : ""}</div>
  </li>`;
}

export default {
  name: "urgent",
  mount() {
    box().addEventListener("click", e => {
      if (!e.target.closest("#show-overdue")) return;
      // Activa Vencidas y limpia el resto de filtros. Orden por plazo descendente para
      // que las vencidas más recientes (las de esta cola) aparezcan primero.
      Object.assign(S, { filterOverdue: true, filterRansomware: false, vendorFilter: null, query: "", sort: { key: "due", dir: -1 } });
      R.registry?.(); R.risk?.();
      $("#s4").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  },
  skeleton() {
    const fig = '<div class="u-fig"><span class="sk" style="width:52px;height:54px"></span><div style="flex:1;display:flex;flex-direction:column;gap:8px"><span class="sk" style="height:12px;width:60%"></span><span class="sk" style="height:10px;width:80%"></span></div></div>';
    box().innerHTML = `<div class="blueprint u-figs" aria-busy="true">${corners}${fig}${fig}${fig.replace("u-fig", "u-fig last")}</div>
      <div class="blueprint u-queue" aria-busy="true">${corners}<div class="sk" style="height:16px;width:40%;margin:4px 0 14px"></div>
      ${'<div class="sk" style="height:44px;margin-bottom:12px;opacity:.6"></div>'.repeat(5)}</div>`;
  },
  unavailable() { box().innerHTML = ""; },
  render() {
    const u = D.urgent;
    $("#s0-desc").textContent = flong(D.today) + " · plazos BOD 22-01 y uso en ransomware";
    box().innerHTML = `
      <div class="blueprint u-figs">${corners}
        ${figure(u.overdue, "crit", "triangle-alert", "Vencidas", `Plazo superado en los últimos ${URGENT_WINDOW} días`)}
        ${figure(u.soon, "warn", "clock", "Vencen en ≤ 7 días", "Incluye las que vencen hoy")}
        ${figure(u.rw30, "crit", "lock", "Ransomware · últimos 30 días", "Altas con uso conocido en campañas", true)}
      </div>
      <div class="blueprint u-queue">${corners}
        <div class="q-head">
          <h3>Cola de prioridad</h3>
          <span class="sub">Vencidas y ransomware primero</span>
          <button class="btn btn-ghost" type="button" id="show-overdue">Ver vencidas en el registro${icon("arrow-down", 14)}</button>
        </div>
        ${u.queue.length
          ? `<ol>${u.queue.map(queueRow).join("")}</ol>`
          : `<p class="q-empty sub">Nada urgente: ninguna entrada vencida en los últimos ${URGENT_WINDOW} días ni con plazo en los próximos 7.</p>`}
      </div>`;
  },
};
