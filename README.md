# Clase 36 – Ejercicio integrador: plataforma de votación en alta disponibilidad

Gestión de Servidores Web · Sección A · Unidad 3 · Clúster + balanceo de carga

> **Caso:** una plataforma de votación en línea para una elección estudiantil necesita garantizar que el
> servicio nunca se caiga durante el día de votación, incluso si un servidor individual falla.

Este repositorio trae la aplicación ya implementada: una landing page (frontend) y una API (backend) que
corren en un clúster de 3 nodos detrás de un balanceador Nginx.

> **El balanceador (`nginx/nginx.conf`) no viene incluido:** cada estudiante lo escribe siguiendo la guía
> de la clase, antes de levantar el clúster.

```
Usuario (navegador / curl)
   |
   v   http://localhost:8089          <- único puerto abierto hacia afuera
[ lb: Nginx ]
   |   red privada clusternet
   +------> nodo1:9095 ┐
   +------> nodo2:9095 ├── carpeta compartida ./datos (votos)
   +------> nodo3:9095 ┘
```

## Requisitos

- Docker Desktop (Windows / macOS) abierto, o Docker Engine + Compose (Linux).
- Git.
- El puerto **8089** libre (el clúster de la Clase 35 usa el 8088, así que puede seguir encendido).

## Levantar

```bash
git clone https://github.com/manasesortez/Clase-36-GSW-Ejercicio-SeccionA.git
cd Clase-36-GSW-Ejercicio-SeccionA
```

**1. Construir la imagen de los nodos** (como `blog.local` en las clases anteriores):

```bash
docker build -t votacion-a-app ./app
```

**2. Antes de levantar**, crear `nginx/nginx.conf` con el contenido de la guía de la clase:

```powershell
# Windows
mkdir nginx
notepad nginx\nginx.conf
```

```bash
# Linux / macOS
mkdir nginx
nano nginx/nginx.conf
```

> Si se ejecuta `docker compose up` sin ese archivo, Docker crea una **carpeta** `nginx/nginx.conf` y el
> balanceador no arranca (`not a directory`). Solución: `docker compose down`, borrar esa carpeta y crear
> el archivo.

**3. Levantar** y validar el balanceador:

```bash
docker compose up -d
docker compose exec lb nginx -t
docker compose ps
```

Abrir **http://localhost:8089** en el navegador.

## Estructura

```
.
├── docker-compose.yml     # 3 nodos + lb, red clusternet, healthchecks (solo lo visto en clase)
├── nginx/nginx.conf       # (lo crea el estudiante, no viene en el repo)
├── app/
│   ├── Dockerfile         # node:22-alpine, sin dependencias externas
│   ├── server.js          # API + servidor de archivos estáticos
│   └── public/            # landing page: arquitectura en vivo, votar, resultados, clúster, consola API
└── scripts/
    ├── prueba.ps1         # N peticiones con nodo, HTTP y tiempo (Windows)
    └── prueba.sh          # lo mismo para Linux / macOS
```

## API

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/health` | Health check del nodo (`{"estado":"saludable","nodo":"nodo1",...}`) |
| GET | `/api/info` | Qué nodo atendió, uptime y peticiones atendidas |
| GET | `/api/cluster` | Estado de los 3 nodos: el nodo que atiende consulta a los otros por `clusternet` |
| GET | `/api/candidatos` | Lista de planillas con sus propuestas |
| GET | `/api/resultados` | Conteo de votos (igual en los 3 nodos) y votos registrados por cada nodo |
| GET | `/api/votos/{carnet}` | Consulta si un carnet ya votó y qué nodo registró el voto |
| POST | `/api/votar` | Body `{"carnet":"2026-0001","candidato":"azul"}` → 201, 400 o 409 (ya votó) |

Todas las respuestas traen el encabezado `X-Nodo` (nodo que respondió) y `X-Upstream` (IP:puerto que eligió Nginx).

## Pruebas rápidas

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File .\scripts\prueba.ps1
docker compose stop nodo2
powershell -ExecutionPolicy Bypass -File .\scripts\prueba.ps1
docker compose start nodo2
```

```bash
# Linux / macOS
bash scripts/prueba.sh
docker compose stop nodo2
bash scripts/prueba.sh
docker compose start nodo2
```

## Decisiones de diseño

- **`docker-compose.yml` solo con lo visto en las Clases 31 a 35:** `image`, `hostname`, `ports`, `volumes`,
  `networks` con `ipv4_address`, `healthcheck` (`test`, `interval`, `retries`), `depends_on` e `ipam`.
- **Solo `lb` publica un puerto.** Los nodos no tienen `ports:`; solo se alcanzan por `clusternet`.
- **Carpeta `./datos` compartida**: los 3 nodos montan la misma carpeta, así todos ven los mismos resultados.
  El bloqueo de voto doble usa la creación atómica de un archivo por carnet, así que no hay votos dobles
  aunque lleguen a nodos distintos.
- **El nombre del nodo sale de `hostname`**: la app responde con el `hostname` del contenedor (`nodo1`...).

Las de Nginx se aplican con el `nginx.conf` que escribe el estudiante:

- **`zone` en el `upstream`**: los workers de Nginx comparten el turno del Round Robin.
- **`proxy_connect_timeout 2s`**: un nodo apagado se detecta en 2 s y no en los 60 s por defecto.
- **Nodos por IP fija** (`172.22.0.11`–`.13`) en lugar de por nombre: Nginx arranca y se reinicia aunque un
  nodo esté apagado (sin el error `host not found in upstream` de la Clase 35).

## Apagar

```bash
docker compose down        # los votos quedan en la carpeta datos/
```

Para borrar los votos, borrar la carpeta `datos/` después del `down`.
