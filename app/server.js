// Plataforma de votación estudiantil - un nodo del clúster.
// Sin dependencias externas: solo módulos de Node.js.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const PORT = Number(process.env.PORT) || 9095;
const NODO = process.env.NODO || os.hostname();
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const VOTOS_FILE = path.join(DATA_DIR, "votos.jsonl");
const CARNETS_DIR = path.join(DATA_DIR, "carnets");
const PUBLIC_DIR = path.join(__dirname, "public");
const INICIO = Date.now();

const PEERS = (process.env.PEERS || "nodo1,nodo2,nodo3").split(",").map((p) => p.trim()).filter(Boolean);

const CANDIDATOS = [
  {
    id: "azul",
    nombre: "Planilla Azul",
    siglas: "PA",
    lema: "Más laboratorios abiertos",
    color: "#2a78d6",
    propuestas: ["Laboratorios abiertos hasta las 9 pm", "Wi-Fi estable en todo el campus", "Tutorías entre estudiantes"],
  },
  {
    id: "naranja",
    nombre: "Planilla Naranja",
    siglas: "PN",
    lema: "Becas y transporte",
    color: "#eb6834",
    propuestas: ["Fondo de becas de emergencia", "Ruta de transporte nocturna", "Descuentos en la cafetería"],
  },
  {
    id: "verde",
    nombre: "Planilla Verde",
    siglas: "PV",
    lema: "Campus sostenible",
    color: "#1baf7a",
    propuestas: ["Paneles solares en los edificios", "Reciclaje en cada aula", "Más zonas verdes y de estudio"],
  },
];

// Consulta /api/info de otro nodo por la red privada (health check activo entre nodos).
function consultarPeer(nombre) {
  return new Promise((resolve) => {
    const inicio = Date.now();
    if (nombre === NODO) {
      return resolve({ nodo: NODO, enLinea: true, ms: 0, uptimeSegundos: Math.round((Date.now() - INICIO) / 1000), peticionesAtendidas });
    }
    const req = http.get({ host: nombre, port: PORT, path: "/api/info", timeout: 800 }, (res) => {
      let datos = "";
      res.on("data", (c) => (datos += c));
      res.on("end", () => {
        try {
          const info = JSON.parse(datos);
          resolve({ nodo: nombre, enLinea: res.statusCode === 200, ms: Date.now() - inicio, uptimeSegundos: info.uptimeSegundos, peticionesAtendidas: info.peticionesAtendidas });
        } catch {
          resolve({ nodo: nombre, enLinea: false, ms: Date.now() - inicio, error: "respuesta inválida" });
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("sin respuesta en 800 ms")));
    req.on("error", (e) => resolve({ nodo: nombre, enLinea: false, ms: Date.now() - inicio, error: e.code || e.message }));
  });
}

fs.mkdirSync(CARNETS_DIR, { recursive: true });

let peticionesAtendidas = 0;

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Nodo": NODO,
  });
  res.end(body);
}

function leerVotos() {
  if (!fs.existsSync(VOTOS_FILE)) return [];
  return fs
    .readFileSync(VOTOS_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((linea) => JSON.parse(linea));
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let datos = "";
    req.on("data", (c) => {
      datos += c;
      if (datos.length > 10_000) reject(new Error("Cuerpo demasiado grande"));
    });
    req.on("end", () => {
      try {
        resolve(datos ? JSON.parse(datos) : {});
      } catch {
        reject(new Error("JSON inválido"));
      }
    });
    req.on("error", reject);
  });
}

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function servirEstatico(req, res, ruta) {
  const archivo = ruta === "/" ? "/index.html" : ruta;
  const completo = path.normalize(path.join(PUBLIC_DIR, archivo));
  if (!completo.startsWith(PUBLIC_DIR) || !fs.existsSync(completo) || fs.statSync(completo).isDirectory()) {
    return json(res, 404, { error: "No encontrado", ruta, nodo: NODO });
  }
  res.writeHead(200, {
    "Content-Type": TIPOS[path.extname(completo)] || "application/octet-stream",
    "X-Nodo": NODO,
  });
  fs.createReadStream(completo).pipe(res);
}

const servidor = http.createServer(async (req, res) => {
  peticionesAtendidas++;
  const url = new URL(req.url, "http://localhost");
  const ruta = url.pathname;
  const inicio = Date.now();
  res.on("finish", () => {
    if (ruta !== "/health" && ruta !== "/api/info" && ruta !== "/api/cluster") {
      console.log(`[${NODO}] ${req.method} ${ruta} -> ${res.statusCode} (${Date.now() - inicio} ms)`);
    }
  });

  try {
    // Health check: lo usan Docker (healthcheck) y las pruebas por el balanceador.
    if (req.method === "GET" && ruta === "/health") {
      return json(res, 200, { estado: "saludable", nodo: NODO, timestamp: new Date().toISOString() });
    }

    // Qué nodo atendió la petición (lo usa el monitor de la página).
    if (req.method === "GET" && ruta === "/api/info") {
      return json(res, 200, {
        nodo: NODO,
        hostname: os.hostname(),
        uptimeSegundos: Math.round((Date.now() - INICIO) / 1000),
        peticionesAtendidas,
        timestamp: new Date().toISOString(),
      });
    }

    // Estado de todos los nodos, visto desde el nodo que atiende la petición.
    if (req.method === "GET" && ruta === "/api/cluster") {
      const nodos = await Promise.all(PEERS.map(consultarPeer));
      return json(res, 200, { nodo: NODO, enLinea: nodos.filter((n) => n.enLinea).length, total: nodos.length, nodos });
    }

    if (req.method === "GET" && ruta === "/api/candidatos") {
      return json(res, 200, { nodo: NODO, candidatos: CANDIDATOS });
    }

    if (req.method === "GET" && ruta === "/api/resultados") {
      const votos = leerVotos();
      const conteo = Object.fromEntries(CANDIDATOS.map((c) => [c.id, 0]));
      const porNodo = {};
      for (const v of votos) {
        if (v.candidato in conteo) conteo[v.candidato]++;
        porNodo[v.nodo] = (porNodo[v.nodo] || 0) + 1;
      }
      return json(res, 200, {
        nodo: NODO,
        total: votos.length,
        resultados: CANDIDATOS.map((c) => ({ ...c, votos: conteo[c.id] })),
        votosRegistradosPorNodo: porNodo,
      });
    }

    // Consulta: ¿este carnet ya votó?
    const matchCarnet = ruta.match(/^\/api\/votos\/([A-Za-z0-9-]{4,20})$/);
    if (req.method === "GET" && matchCarnet) {
      const carnet = matchCarnet[1].toUpperCase();
      const voto = leerVotos().find((v) => v.carnet === carnet);
      return json(res, 200, {
        nodo: NODO,
        carnet,
        yaVoto: Boolean(voto),
        fecha: voto ? voto.fecha : null,
        atendidoPor: voto ? voto.nodo : null,
      });
    }

    if (req.method === "POST" && ruta === "/api/votar") {
      const { carnet, candidato } = await leerCuerpo(req);
      const c = String(carnet || "").trim().toUpperCase();
      if (!/^[A-Z0-9-]{4,20}$/.test(c)) {
        return json(res, 400, { ok: false, nodo: NODO, mensaje: "Carnet inválido (4 a 20 letras, números o guiones)." });
      }
      if (!CANDIDATOS.some((x) => x.id === candidato)) {
        return json(res, 400, { ok: false, nodo: NODO, mensaje: "Candidato inválido." });
      }
      // Crear el archivo del carnet con 'wx' es atómico: si dos nodos reciben el mismo
      // carnet a la vez, solo uno lo logra. Así no hay votos dobles en el clúster.
      try {
        fs.closeSync(fs.openSync(path.join(CARNETS_DIR, c), "wx"));
      } catch (e) {
        if (e.code === "EEXIST") {
          return json(res, 409, { ok: false, nodo: NODO, mensaje: `El carnet ${c} ya votó.` });
        }
        throw e;
      }
      const folio = require("node:crypto").randomBytes(4).toString("hex").toUpperCase();
      const voto = { folio, carnet: c, candidato, nodo: NODO, fecha: new Date().toISOString() };
      fs.appendFileSync(VOTOS_FILE, JSON.stringify(voto) + "\n");
      return json(res, 201, { ok: true, nodo: NODO, mensaje: `Voto registrado por ${NODO}.`, voto });
    }

    if (req.method === "GET" && !ruta.startsWith("/api/")) {
      return servirEstatico(req, res, ruta);
    }

    return json(res, 404, { error: "No encontrado", ruta, nodo: NODO });
  } catch (e) {
    console.error(`[${NODO}] Error:`, e.message);
    return json(res, 500, { ok: false, nodo: NODO, mensaje: e.message });
  }
});

servidor.listen(PORT, () => {
  console.log(`[${NODO}] Plataforma de votación escuchando en el puerto ${PORT}`);
});

// Apagado limpio: sin esto, "docker compose stop" espera 10 s antes de matar el proceso.
for (const senal of ["SIGTERM", "SIGINT"]) {
  process.on(senal, () => {
    console.log(`[${NODO}] Recibí ${senal}, apagando...`);
    servidor.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
