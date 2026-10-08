/* KEV Advisor — orquestación: carga del catálogo, píldora de estado, tema, pie
   y avisos. Cada sección (00–04) vive en su propio módulo de ./sections. */
import { $, esc, fdate, ago, corners } from "./util.js";
import { icon } from "./icons.js";
import { S, R, fetchCatalog, derive, setDerived } from "./data.js";
import urgent from "./sections/urgent.js";
import panorama from "./sections/panorama.js";
import risk from "./sections/risk.js";

// Secciones en orden de página. Cada una expone mount/render y, opcionalmente,
// skeleton (carga inicial) y unavailable (sin datos tras un error).
const sections = [urgent, panorama, risk];
for (const sec of sections) R[sec.name] = () => sec.render();

/* ---------- Tema ---------- */
const themeBtn = $("#theme");
function renderTheme() {
  const dark = S.theme === "dark";
  const label = dark ? "Cambiar a tema claro" : "Cambiar a tema oscuro";
  themeBtn.innerHTML = icon(dark ? "sun" : "moon", 16);
  themeBtn.setAttribute("aria-label", label);
  themeBtn.title = label;
}
themeBtn.addEventListener("click", () => {
  S.theme = S.theme === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", S.theme);
  try { localStorage.setItem("kev-theme", S.theme); } catch (e) {}
  renderTheme();
});
// Sin preferencia guardada, seguir los cambios del sistema.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", e => {
  let saved = null; try { saved = localStorage.getItem("kev-theme"); } catch (_) {}
  if (saved) return;
  S.theme = e.matches ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", S.theme);
  renderTheme();
});

/* ---------- Píldora de estado, botón Actualizar y pie ---------- */
const refreshBtn = $("#refresh");
refreshBtn.innerHTML = icon("refresh-cw", 15) + "Actualizar";
refreshBtn.addEventListener("click", () => load(true));

function renderStatus() {
  const c = S.catalog, pill = $("#status");
  pill.dataset.status = c.status;
  const v = c.meta ? "v" + esc(c.meta.version || "—") : "";
  const parts = {
    loading: ["Conectando…", "consultando CISA"],
    refreshing: ["Actualizando…", "consultando CISA"],
    live: ["En vivo", v + " · " + ago(c.fetchedAt)],
    offline: ["Sin conexión", c.meta ? "usando copia de " + ago(c.fetchedAt) : "sin copia guardada"],
  }[c.status];
  pill.innerHTML = `<span class="sq" aria-hidden="true"></span><strong>${parts[0]}</strong><span class="muted">${parts[1]}</span>`;
  refreshBtn.disabled = c.status === "loading" || c.status === "refreshing";

  $("#foot-meta").textContent = c.meta
    ? "Catálogo v" + (c.meta.version || "—") + " · publicado " + (c.meta.released ? fdate(c.meta.released) : "—") + " · comprobado " + ago(c.fetchedAt)
    : "Catálogo sin cargar";
}

function renderAlert() {
  const c = S.catalog, box = $("#alert");
  if (c.status !== "offline") { box.hidden = true; box.innerHTML = ""; return; }
  const detail = c.meta
    ? `Mostrando la copia guardada de ${ago(c.fetchedAt)} (v${esc(c.meta.version || "—")}).`
    : "Todavía no hay ninguna copia guardada del catálogo. Comprueba la conexión del servidor.";
  box.hidden = false;
  box.innerHTML = `<div class="blueprint alert" role="alert">${corners}${icon("wifi-off", 20)}
    <div class="alert-body"><div class="alert-title">No se pudo conectar con CISA</div>
    <div class="sub">${detail}</div>
    <button class="btn btn-secondary" type="button" id="retry">Reintentar</button></div></div>`;
  $("#retry").addEventListener("click", () => load(true));
}

/* ---------- Carga ---------- */
const renderAll = () => { for (const sec of sections) sec.render(); };

async function load(refresh) {
  const c = S.catalog;
  c.status = c.meta ? "refreshing" : "loading";
  renderStatus();
  if (!c.meta) for (const sec of sections) sec.skeleton?.();
  try {
    const data = await fetchCatalog(refresh);
    Object.assign(c, { records: data.records, meta: data.meta, fetchedAt: data.fetchedAt, status: "live", error: null });
    setDerived(derive(data));
    renderAll();
  } catch (e) {
    c.status = "offline"; c.error = e.message;
    if (!c.meta) for (const sec of sections) sec.unavailable?.();
  }
  renderStatus();
  renderAlert();
}

/* ---------- Arranque ---------- */
renderTheme();
for (const sec of sections) sec.mount?.();
setInterval(() => { if (S.catalog.meta) renderStatus(); }, 60000);
load(false);

