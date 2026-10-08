/* 01 · Panorama — franja de KPIs, Fig. 01 (serie temporal) y Fig. 02 (altas por año). */
import { $, esc, fmt, pct, MES, MES_LARGO, corners } from "../util.js";
import { S, D } from "../data.js";

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const monthLabel = mo => MES[mo.m] + " " + mo.y;

/* ---------- KPIs ---------- */
function kpiCell(label, value, note, sev) {
  return `<div class="kpi">
    <div class="kpi-label">${sev ? `<span class="sq ${sev}" aria-hidden="true"></span>` : ""}${label}</div>
    <div class="kpi-value${sev === "crit" ? " crit" : ""}">${value}</div>
    <div class="sub">${note}</div>
  </div>`;
}
function renderKpis() {
  const k = D.kpis;
  const since = k.since ? MES[+k.since.slice(5, 7) - 1] + " " + k.since.slice(0, 4) : "—";
  $("#kpis").innerHTML = `<div class="blueprint">${corners}<div class="kpi-clip"><div class="kpi-grid">
    ${kpiCell("Total catálogo", fmt(k.total), "entradas desde " + since)}
    ${kpiCell("Añadidas · 30 días", fmt(k.added30), "media 12 meses: " + fmt(k.avg12) + "/mes")}
    ${kpiCell("Uso en ransomware", pct(k.rwPct), fmt(k.rwN) + " entradas", "crit")}
    ${kpiCell("Triaje forense", fmt(k.fxN), "buscar indicios de compromiso", "warn")}
    ${kpiCell("Fabricantes", fmt(k.vendorsN), k.topVendor ? esc(k.topVendor.name) + " concentra el " + pct(k.topVendorPct, 0) : "—")}
  </div></div></div>`;
}

/* ---------- Fig. 01 · Serie temporal ---------- */
const niceStep = (raw, steps) => steps.find(s => s >= raw) || steps[steps.length - 1];
function scale(vals, cumulative) {
  if (!cumulative) {
    const step = niceStep(Math.max(...vals) / 3, [5, 10, 20, 25, 50, 100, 200]);
    const top = Math.max(step, Math.ceil(Math.max(...vals) / step) * step);
    const ticks = []; for (let t = 0; t <= top; t += step) ticks.push(t);
    return { min: 0, max: top, ticks };
  }
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const step = niceStep((hi - lo) / 4, [50, 100, 200, 250, 500, 1000]);
  const min = Math.floor(lo / step) * step, max = Math.max(min + step, Math.ceil(hi / step) * step);
  const ticks = []; for (let t = min; t <= max; t += step) ticks.push(t);
  return { min, max, ticks };
}

let series = null; // geometría de la serie actual, para el hover
function renderSeries() {
  const fig = $("#fig01");
  const cum = S.seriesMode === "cumulative";
  const months = D.months, n = months.length;
  const vals = months.map(mo => (cum ? mo.cum : mo.added));
  const sc = scale(vals, cum);
  const y = v => 100 - (v - sc.min) / (sc.max - sc.min) * 100;
  const pts = vals.map((v, i) => ({ x: i / (n - 1) * 100, y: y(v) }));
  const line = pts.map((p, i) => (i ? "L" : "M") + p.x.toFixed(2) + " " + p.y.toFixed(2)).join(" ");
  const last = months[n - 1], first = months[0];
  series = { pts, months };

  const yTicks = sc.ticks.map(t => ({ label: fmt(t), top: y(t) }));
  const xTicks = months.map((mo, i) => ({ mo, i })).filter(o => o.mo.m === 0).map(o => ({ label: o.mo.y, left: o.i / (n - 1) * 100 }));
  const end = pts[n - 1];

  fig.innerHTML = `${corners}
    <div class="fig-head">
      <div>
        <div class="kicker">Fig. 01</div>
        <h3>${cum ? "Catálogo acumulado" : "Altas mensuales"}</h3>
        <div class="sub">${cap(monthLabel(first))} – ${monthLabel(last)} · pasa el cursor para ver cada mes</div>
      </div>
      <div class="seg" role="radiogroup" aria-label="Modo de la serie">
        <label class="seg-opt"><input type="radio" name="ts-mode" value="monthly"${cum ? "" : " checked"}>Mensual</label>
        <label class="seg-opt"><input type="radio" name="ts-mode" value="cumulative"${cum ? " checked" : ""}>Acumulado</label>
      </div>
    </div>
    <div class="ts-grid">
      <div class="ts-y" aria-hidden="true">${yTicks.map(t => `<span style="top:${t.top}%">${t.label}</span>`).join("")}</div>
      <div class="ts-plot" tabindex="0" role="img"
        aria-label="${cum ? "Catálogo acumulado" : "Altas mensuales"} de ${monthLabel(first)} a ${monthLabel(last)}. Último valor: ${fmt(vals[n - 1])}. Usa las flechas para recorrer los meses.">
        ${yTicks.map(t => `<div class="ts-gridline" style="top:${t.top}%"></div>`).join("")}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path class="ts-area" d="${line} L100 100 L0 100 Z"></path>
          <path class="ts-line" d="${line}"></path>
        </svg>
        <div class="ts-end" style="top:${end.y}%"></div>
        <div class="ts-end-label" style="top:${end.y}%">
          <div class="v">${fmt(vals[n - 1])}</div>
          <div class="l">${cum ? "entradas hoy" : monthLabel(last) + " · mes en curso"}</div>
        </div>
        <div class="ts-hover" aria-hidden="true"></div>
        <div class="ts-cells">${months.map((_, i) => `<div data-i="${i}"></div>`).join("")}</div>
      </div>
      <div></div>
      <div class="ts-x" aria-hidden="true">${xTicks.map(t => `<span style="left:${t.left}%">${t.label}</span>`).join("")}</div>
    </div>
    <figcaption>${cum
      ? "Total de entradas al cierre de cada mes. Fuente: CISA KEV."
      : `Entradas añadidas cada mes. ${cap(MES_LARGO[last.m])} ${last.y} aún en curso. Fuente: CISA KEV.`}</figcaption>`;
  renderHover();
}

function renderHover() {
  const layer = $("#fig01 .ts-hover");
  if (!layer) return;
  const i = S.hoverMonth;
  if (i < 0 || !series || i >= series.pts.length) { layer.innerHTML = ""; return; }
  const p = series.pts[i], mo = series.months[i];
  const shift = p.x > 62 ? "translateX(calc(-100% - 12px))" : "translateX(12px)";
  layer.innerHTML = `<div class="ts-vline" style="left:${p.x}%"></div>
    <div class="ts-mark" style="left:${p.x}%;top:${p.y}%"></div>
    <div class="tip" role="tooltip" style="left:${p.x}%;transform:${shift}">
      <div class="t">${cap(monthLabel(mo))}</div>
      <div>${fmt(mo.added)} altas · ${fmt(mo.cum)} acumuladas</div>
    </div>`;
}

/* ---------- Fig. 02 · Altas por año ---------- */
function renderYears() {
  const years = D.years, max = Math.max(...years.map(y => y.count));
  const t = new Date(D.today);
  const cur = years.find(y => y.partial);
  $("#fig02").innerHTML = `${corners}
    <div>
      <div class="kicker">Fig. 02</div>
      <h3>Altas por año</h3>
      <div class="sub">Entradas añadidas al catálogo cada año</div>
    </div>
    <div class="yr-bars" role="img" aria-label="${years.map(y => y.year + ": " + fmt(y.count) + " altas").join(", ")}">
      ${years.map(y => `<div class="yr-col" aria-hidden="true">
        <span class="yr-val">${fmt(y.count)}</span>
        <div class="yr-bar${y.partial ? " partial" : ""}" title="${y.year}: ${fmt(y.count)} altas" style="height:calc((100% - 25px) * ${(y.count / max).toFixed(4)})"></div>
      </div>`).join("")}
    </div>
    <div class="yr-labels" aria-hidden="true">${years.map(y => `<span>${y.year}</span>`).join("")}</div>
    <figcaption>${years[0] ? years[0].year + " recoge la carga inicial del catálogo." : ""}${cur ? ` ${cur.year} rayado: año en curso, hasta el ${t.getUTCDate()} ${MES[t.getUTCMonth()]}.` : ""}</figcaption>`;
}

/* ---------- Skeletons ---------- */
const skKpi = '<div class="kpi" aria-busy="true"><div class="sk" style="height:10px;width:70%"></div><div class="sk" style="height:36px;width:55%;margin:9px 0"></div><div class="sk" style="height:10px;width:80%"></div></div>';
export const skFig = h => `${corners}<div class="sk" style="height:10px;width:30%"></div><div class="sk" style="height:16px;width:55%"></div>
  <div class="sk-bars" style="height:${h}px">${[40, 75, 55, 30, 65, 50].map(p => `<div class="sk" style="height:${p}%"></div>`).join("")}</div>`;

export default {
  name: "panorama",
  mount() {
    $("#panorama").innerHTML = '<figure class="blueprint fig fig01" id="fig01"></figure><figure class="blueprint fig fig02" id="fig02"></figure>';
    const fig = $("#fig01");
    fig.addEventListener("change", e => {
      if (e.target.name !== "ts-mode") return;
      S.seriesMode = e.target.value;
      renderSeries();
      $(`#fig01 input[value="${S.seriesMode}"]`).focus();
    });
    fig.addEventListener("mouseover", e => {
      const c = e.target.closest(".ts-cells > div");
      if (c && +c.dataset.i !== S.hoverMonth) { S.hoverMonth = +c.dataset.i; renderHover(); }
    });
    fig.addEventListener("mouseleave", () => { S.hoverMonth = -1; renderHover(); });
    fig.addEventListener("focusout", e => { if (e.target.classList.contains("ts-plot")) { S.hoverMonth = -1; renderHover(); } });
    fig.addEventListener("keydown", e => {
      if (!e.target.classList.contains("ts-plot") || !series) return;
      const n = series.pts.length;
      const step = { ArrowRight: 1, ArrowLeft: -1, Home: -n, End: n }[e.key];
      if (!step) return;
      e.preventDefault();
      const i = S.hoverMonth < 0 ? (step > 0 ? 0 : n - 1) : S.hoverMonth + step;
      S.hoverMonth = Math.max(0, Math.min(n - 1, i));
      renderHover();
    });
  },
  skeleton() {
    $("#panorama").hidden = false;
    $("#kpis").innerHTML = `<div class="blueprint">${corners}<div class="kpi-clip"><div class="kpi-grid">${skKpi.repeat(5)}</div></div></div>`;
    $("#fig01").innerHTML = skFig(230); $("#fig02").innerHTML = skFig(230);
  },
  unavailable() { $("#kpis").innerHTML = ""; $("#fig01").innerHTML = corners; $("#fig02").innerHTML = corners; $("#panorama").hidden = true; },
  render() { $("#panorama").hidden = false; renderKpis(); renderSeries(); renderYears(); },
};
