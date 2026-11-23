// Frontend de la plataforma de votación. Todas las peticiones pasan por el balanceador (Nginx).
"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NODOS = ["nodo1", "nodo2", "nodo3"];
const ICONOS = {
  ok: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"/></svg>',
  error: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  espera: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  alerta: '<svg viewBox="0 0 24 24"><path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17h.01"/></svg>',
  server: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/></svg>',
};
const hora = (d = new Date()) => d.toLocaleTimeString("es", { hour12: false });

// ---------------------------------------------------------------- Tema
(function tema() {
  const raiz = document.documentElement;
  try {
    const guardado = localStorage.getItem("tema");
    if (guardado) raiz.dataset.theme = guardado;
  } catch {}
  $("btn-tema").addEventListener("click", () => {
    const oscuroAhora = raiz.dataset.theme
      ? raiz.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    raiz.dataset.theme = oscuroAhora ? "light" : "dark";
    try { localStorage.setItem("tema", raiz.dataset.theme); } catch {}
    dibujarGrafico();
  });
})();

// ---------------------------------------------------------------- HTTP
async function pedir(url, opciones = {}) {
  const inicio = performance.now();
  const control = new AbortController();
  const limite = setTimeout(() => control.abort(), 12000);
  try {
    const res = await fetch(url, { cache: "no-store", signal: control.signal, ...opciones });
    const texto = await res.text();
    let datos = {};
    try { datos = JSON.parse(texto); } catch { datos = { _texto: texto }; }
    return { res, datos, ms: Math.round(performance.now() - inicio), nodo: res.headers.get("X-Nodo") || datos.nodo };
  } finally {
    clearTimeout(limite);
  }
}

function toast(texto) {
  const t = $("toast");
  t.textContent = texto;
  t.hidden = false;
  clearTimeout(toast.temporizador);
  toast.temporizador = setTimeout(() => (t.hidden = true), 3200);
}

async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    toast("Copiado al portapapeles");
  } catch {
    toast("No se pudo copiar: " + texto);
  }
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-copiar]");
  if (b) copiar(b.dataset.copiar);
});

// ---------------------------------------------------------------- Votar
let candidatos = [];
const colorPlanilla = (id) => `var(--c-${id})`;

async function cargarCandidatos() {
  try {
    const { datos, nodo } = await pedir("/api/candidatos");
    candidatos = datos.candidatos || [];
    $("nodo-pagina").textContent = nodo || "—";
  } catch {
    candidatos = [];
  }
  $("candidatos").insertAdjacentHTML(
    "beforeend",
    candidatos
      .map(
        (c) => `
      <label class="candidato" style="--color:${colorPlanilla(c.id)}">
        <input type="radio" name="candidato" value="${esc(c.id)}">
        <div class="candidato-tarjeta">
          <div class="candidato-cab">
            <span class="avatar" aria-hidden="true">${esc(c.siglas)}</span>
            <div>
              <div class="candidato-nombre">${esc(c.nombre)}</div>
              <div class="candidato-lema">${esc(c.lema)}</div>
            </div>
          </div>
          <span class="sr-only">Propuestas:</span>
          <ul class="propuestas">
            ${(c.propuestas || []).map((p) => `<li>${ICONOS.ok}<span>${esc(p)}</span></li>`).join("")}
          </ul>
          <span class="elegir"><span class="check">${ICONOS.ok}</span><span class="elegir-texto">Elegir esta planilla</span></span>
        </div>
      </label>`
      )
      .join("")
  );
  actualizarFormulario();
}

const reCarnet = /^[A-Za-z0-9-]{4,20}$/;
function seleccion() {
  const r = document.querySelector('input[name="candidato"]:checked');
  return r ? candidatos.find((c) => c.id === r.value) : null;
}
function actualizarFormulario() {
  const carnet = $("carnet").value.trim();
  const valido = reCarnet.test(carnet);
  const sel = seleccion();
  $("carnet").setAttribute("aria-invalid", carnet && !valido ? "true" : "false");
  $("resumen-valor").innerHTML = sel
    ? `<span class="muestra" style="background:${colorPlanilla(sel.id)}"></span>${esc(sel.nombre)}`
    : "Ninguna planilla seleccionada";
  document.querySelectorAll(".elegir-texto").forEach((el) => {
    el.textContent = el.closest(".candidato").querySelector("input").checked ? "Seleccionada" : "Elegir esta planilla";
  });
  $("btn-votar").disabled = !(valido && sel);
  const pasos = document.querySelectorAll(".paso");
  pasos[0].className = "paso " + (valido ? "hecho" : "actual");
  pasos[1].className = "paso " + (sel ? "hecho" : valido ? "actual" : "");
  pasos[2].className = "paso " + (valido && sel ? "actual" : "");
}
$("form-voto").addEventListener("input", actualizarFormulario);
$("form-voto").addEventListener("change", actualizarFormulario);

function mostrarAlerta(tipo, texto) {
  const a = $("mensaje-voto");
  a.className = "alerta " + tipo;
  a.innerHTML = (tipo === "error" ? ICONOS.alerta : ICONOS.ok) + `<span>${esc(texto)}</span>`;
  a.hidden = false;
}

$("form-voto").addEventListener("submit", async (e) => {
  e.preventDefault();
  const sel = seleccion();
  const carnet = $("carnet").value.trim();
  if (!sel || !reCarnet.test(carnet)) return;
  const boton = $("btn-votar");
  boton.disabled = true;
  boton.classList.add("cargando");
  $("mensaje-voto").hidden = true;
  try {
    const { res, datos } = await pedir("/api/votar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ carnet, candidato: sel.id }),
    });
    if (res.ok) {
      const v = datos.voto;
      $("cp-folio").textContent = v.folio || "—";
      $("cp-carnet").textContent = v.carnet;
      $("cp-planilla").textContent = sel.nombre;
      $("cp-nodo").textContent = v.nodo;
      $("cp-hora").textContent = hora(new Date(v.fecha));
      $("form-voto").hidden = true;
      document.querySelector(".pasos").hidden = true;
      $("comprobante").hidden = false;
      $("comprobante").focus();
      toast(`Voto registrado por ${v.nodo}`);
      cargarResultados();
    } else {
      mostrarAlerta("error", datos.mensaje || `Error HTTP ${res.status}`);
    }
  } catch (err) {
    mostrarAlerta("error", "No se pudo contactar al servidor. Intenta de nuevo.");
  } finally {
    boton.classList.remove("cargando");
    actualizarFormulario();
  }
});

$("btn-otro-voto").addEventListener("click", () => {
  $("form-voto").reset();
  $("form-voto").hidden = false;
  document.querySelector(".pasos").hidden = false;
  $("comprobante").hidden = true;
  $("mensaje-voto").hidden = true;
  actualizarFormulario();
  $("carnet").focus();
});

$("btn-consultar-carnet").addEventListener("click", async () => {
  const c = $("carnet-consulta").value.trim();
  const salida = $("resultado-carnet");
  if (!reCarnet.test(c)) {
    salida.textContent = "Escribe un carnet válido (4 a 20 caracteres).";
    return;
  }
  try {
    const { datos } = await pedir("/api/votos/" + encodeURIComponent(c));
    salida.textContent = datos.yaVoto
      ? `✔ El carnet ${datos.carnet} ya votó a las ${hora(new Date(datos.fecha))} (registrado por ${datos.atendidoPor}).`
      : `El carnet ${datos.carnet} todavía no ha votado.`;
  } catch {
    salida.textContent = "No se pudo consultar en este momento.";
  }
});

// ---------------------------------------------------------------- Resultados
const NS = "http://www.w3.org/2000/svg";
function dibujarDona(resultados, total) {
  const svg = $("dona");
  const R = 80, ANCHO = 26, C = 2 * Math.PI * R, HUECO = total > 0 && resultados.filter((r) => r.votos > 0).length > 1 ? 3 : 0;
  svg.innerHTML = "";
  const fondo = document.createElementNS(NS, "circle");
  Object.entries({ cx: 100, cy: 100, r: R, "stroke-width": ANCHO, class: "vacia" }).forEach(([k, v]) => fondo.setAttribute(k, v));
  fondo.style.stroke = "var(--grid)";
  svg.appendChild(fondo);
  let acumulado = 0;
  resultados.forEach((r) => {
    if (!r.votos) return;
    const largo = (r.votos / total) * C;
    const seg = document.createElementNS(NS, "circle");
    Object.entries({ cx: 100, cy: 100, r: R, "stroke-width": ANCHO, "stroke-dasharray": `${Math.max(largo - HUECO, 0.5)} ${C}`, "stroke-dashoffset": -acumulado }).forEach(([k, v]) => seg.setAttribute(k, v));
    seg.style.stroke = colorPlanilla(r.id);
    seg.dataset.id = r.id;
    seg.addEventListener("mousemove", (e) => tooltipDona(e, r, total));
    seg.addEventListener("mouseleave", () => { $("tt-dona").hidden = true; resaltarLeyenda(null); });
    svg.appendChild(seg);
    acumulado += largo;
  });
}
function tooltipDona(e, r, total) {
  const caja = e.currentTarget.ownerSVGElement.parentElement.getBoundingClientRect();
  const tt = $("tt-dona");
  tt.innerHTML = `<div class="tt-fila"><span class="muestra" style="background:${colorPlanilla(r.id)}"></span><b>${esc(r.nombre)}</b></div>${r.votos} votos · ${Math.round((r.votos / total) * 100)}%`;
  tt.style.left = e.clientX - caja.left + "px";
  tt.style.top = e.clientY - caja.top + "px";
  tt.hidden = false;
  resaltarLeyenda(r.id);
}
function resaltarLeyenda(id) {
  document.querySelectorAll("#leyenda li").forEach((li) => li.classList.toggle("resaltada", li.dataset.id === id));
}

function barras(contenedor, filas, total) {
  if (!total) {
    contenedor.innerHTML = '<p class="vacio">Aún no hay votos. ¡Sé el primero!</p>';
    return;
  }
  const max = Math.max(...filas.map((f) => f.valor), 1);
  contenedor.innerHTML = filas
    .map(
      (f) => `
    <div class="barra-fila" title="${esc(f.etq)}: ${f.valor}">
      <span class="barra-etq"><span class="muestra" style="background:${f.color}"></span><span>${esc(f.etq)}</span></span>
      <span class="barra-pista"><span class="barra-relleno" style="--color:${f.color}" data-ancho="${(f.valor / max) * 100}"></span></span>
      <span class="barra-valor">${f.valor} <small>${Math.round((f.valor / total) * 100)}%</small></span>
    </div>`
    )
    .join("");
  requestAnimationFrame(() => contenedor.querySelectorAll(".barra-relleno").forEach((b) => (b.style.width = b.dataset.ancho + "%")));
}

async function cargarResultados() {
  let datos;
  try {
    ({ datos } = await pedir("/api/resultados"));
  } catch {
    return;
  }
  if (!datos.resultados) return;
  const total = datos.total || 0;
  $("nodo-resultados").textContent = datos.nodo;
  $("dona-total").textContent = total;
  $("st-votos").textContent = total;
  dibujarDona(datos.resultados, total);

  const ordenados = [...datos.resultados].sort((a, b) => b.votos - a.votos);
  const lider = total && ordenados[0].votos > (ordenados[1]?.votos ?? -1) ? ordenados[0] : null;
  $("st-lider").textContent = !total ? "Sin votos todavía" : lider ? `Lidera ${lider.nombre}` : "Empate en el primer lugar";

  $("leyenda").innerHTML = datos.resultados
    .map((r) => `
      <li data-id="${esc(r.id)}">
        <span class="muestra" style="background:${colorPlanilla(r.id)}"></span>
        <span>${esc(r.nombre)}${lider && lider.id === r.id ? '<span class="lider">Lidera</span>' : ""}</span>
        <span class="valor">${r.votos}</span>
        <span class="pct">${total ? Math.round((r.votos / total) * 100) : 0}%</span>
      </li>`)
    .join("");

  barras($("barras"), datos.resultados.map((r) => ({ etq: r.nombre, valor: r.votos, color: colorPlanilla(r.id) })), total);
  const porNodo = datos.votosRegistradosPorNodo || {};
  barras($("barras-nodos"), NODOS.map((n) => ({ etq: n, valor: porNodo[n] || 0, color: `var(--n-${n})` })), total);
}

// ---------------------------------------------------------------- Monitor (1 petición / s)
const historial = []; // { t, nodo, ms, ok, status }
const MAX_HIST = 60;
let monitorActivo = true;
let ultimoOk = null;

async function latido() {
  if (!monitorActivo) return;
  const t = new Date();
  let punto;
  try {
    const { res, datos, ms, nodo } = await pedir("/api/info");
    punto = { t, nodo: nodo || datos.nodo || "?", ms, ok: res.ok, status: res.status };
  } catch {
    punto = { t, nodo: null, ms: 0, ok: false, status: "sin respuesta" };
  }
  historial.push(punto);
  if (historial.length > MAX_HIST) historial.shift();

  // Estado general
  if (ultimoOk !== null && ultimoOk !== punto.ok) {
    evento(punto.ok ? "ok" : "error", punto.ok ? "El servicio volvió a responder" : `El balanceador no respondió (${punto.status})`);
  }
  ultimoOk = punto.ok;
  if (punto.ok && punto.ms > 1000) {
    evento("alerta", `Petición lenta (${punto.ms} ms): Nginx reintentó en ${punto.nodo}`);
  }

  // Nodo que atendió
  document.querySelectorAll(".arq-nodo").forEach((li) => li.classList.toggle("activo", li.dataset.nodo === punto.nodo));

  // Indicadores
  const ok = historial.filter((h) => h.ok).length;
  $("st-disp").textContent = ((ok / historial.length) * 100).toFixed(ok === historial.length ? 0 : 1) + "%";
  $("st-disp-pie").textContent = `${ok} de ${historial.length} peticiones con éxito`;
  const ultimos = historial.slice(-30).filter((h) => h.ok).map((h) => h.ms).sort((a, b) => a - b);
  $("st-lat").textContent = ultimos.length ? ultimos[Math.floor(ultimos.length / 2)] + " ms" : "–";
  dibujarGrafico();
}

// Gráfico de barras: tiempo de respuesta por petición
function dibujarGrafico() {
  const svg = $("grafico");
  const W = svg.clientWidth || 800, H = 220;
  const M = { t: 10, r: 8, b: 22, l: 46 };
  const ancho = W - M.l - M.r, alto = H - M.t - M.b;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const maxDato = Math.max(50, ...historial.map((h) => h.ms));
  const paso = [50, 100, 250, 500, 1000, 2500, 5000, 10000].find((p) => p * 2 >= maxDato) || 10000;
  const yMax = Math.ceil(maxDato / paso) * paso;
  const y = (v) => M.t + alto - (v / yMax) * alto;
  const slot = ancho / MAX_HIST;
  const bw = Math.max(slot - 2, 1);

  let html = "";
  for (let v = 0; v <= yMax; v += paso) {
    html += `<line class="${v === 0 ? "eje" : "grid-linea"}" x1="${M.l}" x2="${W - M.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    html += `<text x="${M.l - 8}" y="${y(v) + 4}" text-anchor="end">${v >= 1000 ? v / 1000 + " s" : v + " ms"}</text>`;
  }
  const desfase = MAX_HIST - historial.length;
  historial.forEach((h, i) => {
    const x = M.l + (desfase + i) * slot + (slot - bw) / 2;
    if (h.ok) {
      const top = Math.min(y(h.ms), y(0) - 2);
      const r = Math.min(4, bw / 2, y(0) - top);
      html += `<path class="barra" d="M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${y(0)} Z" style="fill:var(--n-${esc(h.nodo)}, var(--tenue))"/>`;
    } else {
      html += `<rect class="barra" x="${x}" y="${M.t}" width="${bw}" height="${alto}" fill="url(#rayas)" style="stroke:var(--critico);stroke-width:1"/>`;
    }
    html += `<rect class="hit" data-i="${i}" x="${M.l + (desfase + i) * slot}" y="${M.t}" width="${slot}" height="${alto}"/>`;
  });
  if (!historial.length) html += `<text x="${M.l + ancho / 2}" y="${M.t + alto / 2}" text-anchor="middle">Esperando datos…</text>`;
  html += `<text x="${W - M.r}" y="${H - 4}" text-anchor="end">ahora</text><text x="${M.l}" y="${H - 4}">hace ${MAX_HIST} s</text>`;
  svg.innerHTML =
    `<defs><pattern id="rayas" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" style="fill:var(--critico-suave)"/><line x1="0" y1="0" x2="0" y2="6" style="stroke:var(--critico);stroke-width:2"/></pattern></defs>` + html;
}
$("grafico").addEventListener("mousemove", (e) => {
  const hit = e.target.closest("rect.hit");
  const tt = $("tt-grafico");
  if (!hit) { tt.hidden = true; return; }
  const h = historial[+hit.dataset.i];
  if (!h) return;
  const caja = $("grafico").getBoundingClientRect();
  tt.innerHTML = h.ok
    ? `<div class="tt-fila"><span class="muestra" style="background:var(--n-${esc(h.nodo)})"></span><b>${esc(h.nodo)}</b></div>${h.ms} ms · HTTP ${h.status}<br><span style="opacity:.7">${hora(h.t)}</span>`
    : `<div class="tt-fila"><span class="muestra muestra-error"></span><b>Sin respuesta</b></div>${esc(h.status)}<br><span style="opacity:.7">${hora(h.t)}</span>`;
  tt.style.left = Math.min(Math.max(e.clientX - caja.left, 70), caja.width - 70) + "px";
  tt.style.top = e.clientY - caja.top + "px";
  tt.hidden = false;
});
$("grafico").addEventListener("mouseleave", () => ($("tt-grafico").hidden = true));
new ResizeObserver(() => dibujarGrafico()).observe($("grafico"));

$("btn-monitor").addEventListener("click", (e) => {
  monitorActivo = !monitorActivo;
  const b = e.currentTarget;
  b.setAttribute("aria-pressed", String(!monitorActivo));
  b.querySelector("span").textContent = monitorActivo ? "Pausar" : "Reanudar";
  b.querySelector(".ico-pausa").style.display = monitorActivo ? "" : "none";
  b.querySelector(".ico-play").style.display = monitorActivo ? "none" : "";
  evento("info", monitorActivo ? "Monitor reanudado" : "Monitor en pausa");
});
document.querySelector("#btn-monitor .ico-play").style.display = "none";

// ---------------------------------------------------------------- Estado de los nodos (/api/cluster)
const estadoPrevio = {};
function tarjetaNodo(n) {
  return `
  <article class="nodo-tarjeta" data-nodo="${n}" aria-live="polite">
    <div class="nodo-cab">
      <span class="nodo-nombre"><span class="server">${ICONOS.server}</span>${n}</span>
      <span class="estado espera">${ICONOS.espera}<span>Verificando</span></span>
    </div>
    <dl class="nodo-datos">
      <div><dt>Encendido</dt><dd class="d-uptime">–</dd></div>
      <div><dt>Peticiones</dt><dd class="d-pet">–</dd></div>
      <div><dt>Respuesta</dt><dd class="d-ms">–</dd></div>
    </dl>
    <div class="nodo-barra" aria-hidden="true"><span style="width:0"></span></div>
    <p class="nodo-pie">Tráfico de esta sesión: <b class="d-sesion">0</b> peticiones</p>
  </article>`;
}
$("nodos-grid").innerHTML = NODOS.map(tarjetaNodo).join("");

function duracion(s) {
  if (s == null) return "–";
  if (s < 60) return s + " s";
  if (s < 3600) return Math.floor(s / 60) + " min";
  return Math.floor(s / 3600) + " h " + Math.floor((s % 3600) / 60) + " min";
}

async function cargarCluster() {
  let datos = null;
  try {
    ({ datos } = await pedir("/api/cluster"));
  } catch {}
  const lista = datos && datos.nodos ? datos.nodos : NODOS.map((n) => ({ nodo: n, enLinea: null }));
  const conteoSesion = Object.fromEntries(NODOS.map((n) => [n, historial.filter((h) => h.ok && h.nodo === n).length]));
  const maxSesion = Math.max(1, ...Object.values(conteoSesion));

  lista.forEach((n) => {
    const tarjeta = document.querySelector(`.nodo-tarjeta[data-nodo="${n.nodo}"]`);
    const arq = document.querySelector(`.arq-nodo[data-nodo="${n.nodo}"]`);
    if (!tarjeta || !arq) return;
    const estado = n.enLinea === null ? "espera" : n.enLinea ? "ok" : "error";
    const texto = estado === "ok" ? "En línea" : estado === "error" ? "Sin respuesta" : "Desconocido";
    const e = tarjeta.querySelector(".estado");
    e.className = "estado " + estado;
    e.innerHTML = ICONOS[estado] + `<span>${texto}</span>`;
    tarjeta.classList.toggle("caido", estado === "error");
    tarjeta.querySelector(".d-uptime").textContent = n.enLinea ? duracion(n.uptimeSegundos) : "–";
    tarjeta.querySelector(".d-pet").textContent = n.enLinea ? n.peticionesAtendidas : "–";
    tarjeta.querySelector(".d-ms").textContent = n.enLinea ? (n.nodo === datos.nodo ? "local" : n.ms + " ms") : "–";
    tarjeta.querySelector(".d-sesion").textContent = conteoSesion[n.nodo];
    tarjeta.querySelector(".nodo-barra span").style.width = (conteoSesion[n.nodo] / maxSesion) * 100 + "%";

    arq.classList.toggle("caido", estado === "error");
    arq.classList.toggle("en-linea", estado === "ok");
    arq.querySelector(".estado-ico").innerHTML = ICONOS[estado];
    arq.querySelector("small").textContent = texto;

    if (estado !== "espera" && estadoPrevio[n.nodo] && estadoPrevio[n.nodo] !== estado) {
      evento(estado === "ok" ? "ok" : "error", estado === "ok" ? `${n.nodo} volvió a estar en línea` : `${n.nodo} dejó de responder (${n.error || "sin respuesta"})`);
    }
    if (estado !== "espera") estadoPrevio[n.nodo] = estado;
  });

  const enLinea = datos ? datos.enLinea : 0;
  $("st-nodos").textContent = datos ? enLinea : "–";
  const pie = $("st-nodos-pie");
  pie.className = "stat-pie " + (!datos ? "error" : enLinea === datos.total ? "ok" : "error");
  pie.textContent = !datos ? "Sin conexión con el clúster" : enLinea === datos.total ? "Todos los nodos responden" : `${datos.total - enLinea} nodo(s) sin responder`;
  $("arq-sub").textContent = datos ? `verificado por ${datos.nodo} · ${hora()}` : "sin conexión";
}

// ---------------------------------------------------------------- Eventos
function evento(tipo, texto) {
  const li = document.createElement("li");
  li.className = "evento evento-" + (tipo === "alerta" ? "error" : tipo);
  li.innerHTML = `<span class="evento-hora">${hora()}</span>${ICONOS[tipo] || ICONOS.info}<span>${esc(texto)}</span>`;
  const lista = $("eventos");
  lista.prepend(li);
  while (lista.children.length > 30) lista.lastChild.remove();
}
evento("info", "Monitor iniciado");

// ---------------------------------------------------------------- Consola de la API
const ENDPOINTS = [
  { metodo: "GET", ruta: "/health", desc: "Health check del nodo. Es lo que consulta Docker cada 5 s." },
  { metodo: "GET", ruta: "/api/info", desc: "Qué nodo atendió, cuánto tiempo lleva encendido y cuántas peticiones ha atendido." },
  { metodo: "GET", ruta: "/api/cluster", desc: "El nodo que atiende consulta a los otros por la red privada clusternet." },
  { metodo: "GET", ruta: "/api/candidatos", desc: "Lista de planillas con sus propuestas." },
  { metodo: "GET", ruta: "/api/resultados", desc: "Conteo de votos (igual en los 3 nodos) y votos registrados por cada nodo." },
  { metodo: "GET", ruta: "/api/votos/{carnet}", desc: "Consulta si un carnet ya votó y qué nodo registró su voto.", param: { etq: "Carnet", valor: "2026-0001" } },
  { metodo: "POST", ruta: "/api/votar", desc: "Registra un voto. Responde 201, 400 (datos inválidos) o 409 (el carnet ya votó).", param: { etq: "Cuerpo JSON", valor: '{"carnet":"2026-0100","candidato":"azul"}' } },
];
let endpointActual = ENDPOINTS[0];

function urlEndpoint() {
  const ep = endpointActual;
  return ep.ruta.includes("{carnet}") ? ep.ruta.replace("{carnet}", encodeURIComponent($("api-param-valor").value.trim() || "2026-0001")) : ep.ruta;
}

function elegirEndpoint(ep) {
  endpointActual = ep;
  document.querySelectorAll(".endpoint").forEach((li) => li.setAttribute("aria-selected", String(li.dataset.ruta === ep.ruta)));
  const m = $("api-metodo");
  m.textContent = ep.metodo;
  m.className = "metodo metodo-" + ep.metodo.toLowerCase();
  $("api-url").textContent = ep.ruta;
  $("api-desc").textContent = ep.desc;
  $("api-param").hidden = !ep.param;
  if (ep.param) {
    $("api-param-etq").textContent = ep.param.etq;
    $("api-param-valor").value = ep.param.valor;
  }
}

$("endpoints").innerHTML = ENDPOINTS.map(
  (ep) => `<li class="endpoint" role="option" tabindex="0" data-ruta="${esc(ep.ruta)}" aria-selected="false">
    <span class="metodo metodo-${ep.metodo.toLowerCase()}">${ep.metodo}</span><code>${esc(ep.ruta)}</code>
    <small>${esc(ep.desc.split(".")[0])}</small></li>`
).join("");
$("endpoints").addEventListener("click", (e) => {
  const li = e.target.closest(".endpoint");
  if (li) elegirEndpoint(ENDPOINTS.find((x) => x.ruta === li.dataset.ruta));
});
$("endpoints").addEventListener("keydown", (e) => {
  const li = e.target.closest(".endpoint");
  if (!li) return;
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); li.click(); }
  if (e.key === "ArrowDown") li.nextElementSibling?.focus();
  if (e.key === "ArrowUp") li.previousElementSibling?.focus();
});

function resaltarJSON(obj) {
  return esc(JSON.stringify(obj, null, 2)).replace(
    /(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g,
    (m, cadena, dosPuntos, bool, num) => {
      if (cadena) return dosPuntos ? `<span class="j-clave">${cadena}</span>${dosPuntos}` : `<span class="j-texto">${cadena}</span>`;
      if (bool) return `<span class="j-bool">${bool}</span>`;
      return `<span class="j-num">${num}</span>`;
    }
  );
}

$("btn-api").addEventListener("click", async () => {
  const ep = endpointActual;
  const url = urlEndpoint();
  const opciones = ep.metodo === "POST" ? { method: "POST", headers: { "Content-Type": "application/json" }, body: $("api-param-valor").value } : {};
  $("btn-api").disabled = true;
  try {
    const { res, datos, ms, nodo } = await pedir(url, opciones);
    $("api-meta").hidden = false;
    const st = $("api-status");
    st.textContent = res.status;
    st.className = "estado-http " + (res.ok ? "ok" : "error");
    $("api-tiempo").textContent = ms + " ms";
    $("api-nodo").textContent = nodo || "—";
    $("api-salida").innerHTML = resaltarJSON(datos);
    if (ep.ruta === "/api/votar") cargarResultados();
  } catch (err) {
    $("api-meta").hidden = true;
    $("api-salida").innerHTML = `<span class="j-bool">Error: ${esc(err.message)}</span>`;
  } finally {
    $("btn-api").disabled = false;
  }
});

$("btn-curl").addEventListener("click", () => {
  const base = location.origin;
  const ep = endpointActual;
  const cmd = ep.metodo === "POST"
    ? `curl -s -X POST ${base}${urlEndpoint()} -H "Content-Type: application/json" -d '${$("api-param-valor").value}'`
    : `curl -s ${base}${urlEndpoint()}`;
  copiar(cmd);
});

elegirEndpoint(ENDPOINTS[0]);

// ---------------------------------------------------------------- Inicio
cargarCandidatos().then(cargarResultados);
cargarCluster();
latido();
setInterval(latido, 1000);
setInterval(cargarCluster, 2000);
setInterval(cargarResultados, 3000);
