/* 02 · Riesgo — Fig. 03 (donut CWE) y Fig. 04 (fabricantes, filtra el registro). */
import { $, esc, fmt, pct, corners } from "../util.js";
import { S, D, R } from "../data.js";
import { skFig } from "./panorama.js";

// Paleta categórica = rampa de acero (sin colores ajenos); "Otros" en neutro.
const CWE_COLORS = ["var(--color-accent-900)", "var(--color-accent-700)", "var(--color-accent-500)", "var(--color-accent-400)",
  "var(--color-accent-300)", "var(--color-accent-200)", "var(--color-neutral-300)"];

/* ---------- Fig. 03 ---------- */
function renderCwe() {
  const total = D.rows.length;
  let acc = 0;
  const segs = D.cwe.map((c, i) => {
    const p = total ? c.count / total * 100 : 0;
    const seg = { ...c, i, p, color: CWE_COLORS[i], dash: Math.max(0, p - 0.5).toFixed(2) + " " + (100 - p + 0.5).toFixed(2), off: ((100 - acc) % 100).toFixed(2) };
    acc += p;
    return seg;
  });
  $("#fig03").innerHTML = `${corners}
    <div>
      <div class="kicker">Fig. 03</div>
      <h3>Tipos de debilidad (CWE)</h3>
      <div class="sub">Las seis más frecuentes sobre ${fmt(total)} entradas</div>
    </div>
    <div class="cwe-body">
      <div class="donut">
        <svg viewBox="0 0 42 42" width="184" height="184" aria-hidden="true">
          ${segs.map(s => `<circle data-i="${s.i}" cx="21" cy="21" r="15.915" style="stroke:${s.color};stroke-dasharray:${s.dash};stroke-dashoffset:${s.off}"></circle>`).join("")}
        </svg>
        <div class="donut-center" aria-hidden="true"><span class="v"></span><span class="l"></span></div>
      </div>
      <ul class="cwe-legend">
        ${segs.map(s => `<li data-i="${s.i}" tabindex="0">
          <span class="sw" style="background:${s.color}" aria-hidden="true"></span>
          <span class="nm"><strong>${esc(s.id)}</strong> <span class="muted">${esc(s.name)}</span></span>
          <span>${fmt(s.count)}</span>
          <span class="muted pc">${pct(s.p)}</span>
        </li>`).join("")}
      </ul>
    </div>`;
  renderCweHover();
}

function renderCweHover() {
  const h = S.hoverCwe;
  document.querySelectorAll("#fig03 [data-i]").forEach(el => el.classList.toggle("dim", h >= 0 && +el.dataset.i !== h));
  const c = h >= 0 ? D.cwe[h] : null;
  const center = $("#fig03 .donut-center");
  if (!center) return;
  center.querySelector(".v").textContent = c ? fmt(c.count) : fmt(D.rows.length);
  center.querySelector(".l").textContent = c ? c.id : "entradas";
}

/* ---------- Fig. 04 ---------- */
function renderVendors() {
  const list = D.vendorsTop, max = Math.max(1, ...list.map(v => v.count));
  $("#fig04").innerHTML = `${corners}
    <div class="fig-head">
      <div>
        <div class="kicker">Fig. 04</div>
        <h3>Fabricantes más afectados</h3>
        <div class="sub">Pulsa un fabricante para filtrar el registro</div>
      </div>
      <div class="legend" aria-hidden="true"><span><span class="sq crit"></span>Ransomware</span><span><span class="sq acc"></span>Resto</span></div>
    </div>
    <ul class="vendors">
      ${list.map(v => {
        const on = S.vendorFilter === v.name;
        return `<li><button type="button" class="vendor${on ? " on" : ""}" data-vendor="${esc(v.name)}" aria-pressed="${on}"
          aria-label="${esc(v.name)}: ${fmt(v.count)} entradas, ${fmt(v.rw)} con ransomware. Filtrar el registro">
          <span class="vn">${esc(v.name)}</span>
          <span class="vbar" aria-hidden="true"><span class="rw" style="width:${(v.rw / max * 100).toFixed(2)}%"></span><span class="rest" style="width:${((v.count - v.rw) / max * 100).toFixed(2)}%"></span></span>
          <span class="vc" aria-hidden="true"><strong>${fmt(v.count)}</strong><span class="vrw">${fmt(v.rw)} rw</span></span>
        </button></li>`;
      }).join("")}
    </ul>`;
}

export default {
  name: "risk",
  mount() {
    $("#risk").innerHTML = '<figure class="blueprint fig fig03" id="fig03"></figure><figure class="blueprint fig fig04" id="fig04"></figure>';
    const f3 = $("#fig03");
    const setHover = i => { if (i !== S.hoverCwe) { S.hoverCwe = i; renderCweHover(); } };
    f3.addEventListener("mouseover", e => { const li = e.target.closest(".cwe-legend li"); if (li) setHover(+li.dataset.i); });
    f3.addEventListener("mouseleave", () => setHover(-1));
    f3.addEventListener("focusin", e => { const li = e.target.closest(".cwe-legend li"); if (li) setHover(+li.dataset.i); });
    f3.addEventListener("focusout", () => setHover(-1));
    $("#fig04").addEventListener("click", e => {
      const b = e.target.closest("button[data-vendor]");
      if (!b) return;
      const name = b.dataset.vendor;
      S.vendorFilter = S.vendorFilter === name ? null : name;
      renderVendors();
      $(`#fig04 button[data-vendor="${CSS.escape(name)}"]`).focus();
      R.registry?.();
    });
  },
  skeleton() { $("#risk").hidden = false; $("#fig03").innerHTML = skFig(184); $("#fig04").innerHTML = skFig(184); },
  unavailable() { $("#risk").hidden = true; },
  render() { $("#risk").hidden = false; renderCwe(); renderVendors(); },
};
