# Tiquart — los 15 contenedores del proyecto

**Documento técnico de infraestructura**  
**Proyecto:** Tiquart — venta de boletas sin doble venta  
**Entorno:** Docker Compose sobre Ubuntu WSL 2  
**Fecha de referencia:** 26 de octubre de 2026

> Este documento describe los **15 contenedores que están activos** en la demo. En
> `compose.yml` hay **16 servicios definidos**: los 15 activos más `k6`, que solo se levanta
> con el perfil `load` para las pruebas de carga y no forma parte de la operación normal.

---

## 1. Resumen de los 15 contenedores

| # | Contenedor | Servicio | Imagen | Perfil | Función principal |
|---|---|---|---|---|---|
| 1 | `tiquart-traefik-1` | `traefik` | `traefik:v3.7` | base | Reverse proxy y única puerta HTTP de la app |
| 2 | `tiquart-cloudflared-1` | `cloudflared` | `cloudflare/cloudflared:latest` | `tunnel` | Túnel público HTTPS de respaldo |
| 3 | `tiquart-web-1` | `web` | build `tiquart-web` | base | Frontend Next.js / React |
| 4 | `tiquart-api-1` | `api` | build `tiquart-api` | base | Backend FastAPI y toda la lógica de negocio |
| 5 | `tiquart-db-1` | `db` | `postgres:18-alpine` | base | Base de datos, fuente de verdad |
| 6 | `tiquart-cache-1` | `cache` | `valkey/valkey:9-alpine` | base | Rate limiting en memoria |
| 7 | `tiquart-mosquitto-1` | `mosquitto` | `eclipse-mosquitto:2` | base | Broker MQTT para eventos en vivo |
| 8 | `tiquart-prometheus-1` | `prometheus` | `prom/prometheus:latest` | `obs` | Recolección y consulta de métricas |
| 9 | `tiquart-grafana-1` | `grafana` | `grafana/grafana:latest` | `obs` | Dashboards de observabilidad |
| 10 | `tiquart-cadvisor-1` | `cadvisor` | `gcr.io/cadvisor/cadvisor:latest` | `obs` | Métricas por contenedor |
| 11 | `tiquart-node-exporter-1` | `node-exporter` | `prom/node-exporter:latest` | `obs` | Métricas del host WSL |
| 12 | `tiquart-portainer-1` | `portainer` | `portainer/portainer-ce:latest` | `rubric` | Panel de administración de Docker |
| 13 | `tiquart-glances-1` | `glances` | `nicolargo/glances:latest-full` | `rubric` | Monitor de recursos en tiempo real |
| 14 | `tiquart-wg-easy-1` | `wg-easy` | `ghcr.io/wg-easy/wg-easy:latest` | `rubric` | Servidor WireGuard + panel VPN |
| 15 | `tiquart-samba-1` | `samba` | `dperson/samba:latest` | `rubric` | Carpeta compartida por SMB |

### Lo que no es un contenedor

- **Tailscale Funnel** es el ingress público principal, pero corre en el **host Windows**, no
  dentro de Docker. Publica `https://cristian-pc.taile80b95.ts.net` y reenvía a
  `http://127.0.0.1:8080`, que es Traefik.
- **Cloudflare** es el túnel de respaldo y sí es el contenedor `cloudflared`.
- **PostgreSQL, Valkey, MQTT, API y web** no están publicados directamente a Internet: solo se
  llega a ellos a través de Traefik o de la red interna de Docker.

---

## 2. Cómo se agrupan por capas

```
                         Internet / celulares
                                  │
             ┌────────────────────┴────────────────────┐
             │                                         │
   Tailscale Funnel (host)                  cloudflared (contenedor)
   HTTPS estable                            HTTPS efímero de respaldo
             │                                         │
             └────────────────────┬────────────────────┘
                                  ▼
                         traefik:80  (host 8080)
                          ├── /      ──────────────► web:3000
                          └── /api   ──────────────► api:8000
                                                       │
                            ┌──────────────────────────┼──────────────────────────┐
                            ▼                          ▼                          ▼
                         db:5432                   cache:6379                mosquitto:1883
                    fuente de verdad          rate limit (AP)              eventos (AP)

  Observabilidad:  Prometheus ──► api, cadvisor, node-exporter, sí mismo
                   Grafana    ──► Prometheus (dashboard)
                   cAdvisor   ──► métricas de contenedores
                   node-exporter ──► métricas del host WSL

  Rúbrica:         Portainer  ──► Docker socket
                   Glances    ──► host + Docker socket
                   WG-Easy    ──► WireGuard
                   Samba      ──► carpeta compartida
```

### Perfiles de Docker Compose

| Perfil | Contenedores | Para qué se levanta |
|---|---|---|
| *(sin perfil)* | `db`, `cache`, `mosquitto`, `api`, `web`, `traefik` | Núcleo de la tienda |
| `tunnel` | `cloudflared` | URL pública de respaldo |
| `obs` | `prometheus`, `grafana`, `cadvisor`, `node-exporter` | Observabilidad y dashboard |
| `rubric` | `portainer`, `glances`, `wg-easy`, `samba` | Los 5 servicios de la rúbrica |
| `load` | `k6` | Prueba de carga, **no** es uno de los 15 activos |

Comandos habituales:

```bash
make up        # 6 contenedores base
make obs       # + 4 de observabilidad
make rubric    # + 4 de la rúbrica
make tunnel    # + cloudflared

# Todo junto:
docker compose --profile obs --profile rubric --profile tunnel up -d
```

`docker compose up -d` sin perfiles **no** levanta observabilidad, rúbrica ni túnel. Los
contenedores que ya estén corriendo se mantienen.

---

## 3. Flujo de una compra visto desde los contenedores

1. El celular entra por **Tailscale Funnel** (o por el túnel de Cloudflare) y llega a **Traefik**.
2. Traefik sirve la interfaz desde **web** en `/` y manda las llamadas `/api/*` a **api**,
   quitando el prefijo `/api`.
3. **web** pide el catálogo a **api**; **api** consulta **db**.
4. Al abrir un evento, **web** abre un `EventSource` contra `/api/sse/events/{id}`. **api**
   mantiene el stream SSE y publica los cambios de asientos.
5. Al reservar, **api** aplica el rate limit contra **cache**, ejecuta el `UPDATE` atómico en
   **db** y publica el cambio por **mosquitto**. Los navegadores lo reciben por SSE.
6. Al pagar (pago simulado), **api** crea la orden y las boletas dentro de una transacción,
   vuelve a publicar el estado `sold` y actualiza las métricas.
7. **web** muestra el QR generado por **api** en `/boletas`.
8. **Prometheus** scrapea las métricas cada 5 s; **Grafana** las dibuja. **cAdvisor** y
   **node-exporter** aportan CPU/RAM por contenedor y del host.
9. En paralelo, `make live` se conecta a **mosquitto** para proyectar los eventos MQTT.

> El pago es **simulado**: no existe un contenedor de pasarela de pago. El checkout de **api**
> marca la orden como pagada y emite las boletas.

---

## 4. Detalle de cada contenedor

### 4.1 `traefik` — la puerta de entrada HTTP

| Dato | Valor |
|---|---|
| Contenedor | `tiquart-traefik-1` |
| Imagen | `traefik:v3.7` |
| Perfil | base (sin perfil) |
| Red | `tiquart_default` (IP observada `172.18.0.7`) |
| Puertos | `0.0.0.0:8080 → 80/tcp` |
| Volumen | `./infra/traefik → /etc/traefik/dynamic:ro` |
| Depende de | `api`, `web` |
| Healthcheck | no definido |
| Reinicio | `unless-stopped` |

**Qué es.** Traefik es un reverse proxy y router HTTP moderno. En este proyecto se configura
con el *file provider*: lee archivos YAML de `/etc/traefik/dynamic` y los recarga solo cuando
cambian (`--providers.file.watch=true`), sin necesidad de reiniciar.

**Qué hace en Tiquart.** Es el único punto de entrada HTTP del stack local. Recibe el tráfico
del host en el puerto `8080` y lo reparte según la ruta:

- `PathPrefix('/api')`, prioridad 20 → middleware `strip-api` → `http://api:8000`.
- `PathPrefix('/')`, prioridad 1 → `http://web:3000`.

También genera logs de acceso en JSON (`--accesslog=true`), útiles para ver cuántas peticiones
entran durante la compra masiva.

**Por qué está así.** Evita publicar `web` y `api` directamente al host, mantiene un solo
origen (`/` y `/api` bajo el mismo dominio) y permite que SSE pase sin buffering. El TLS **no**
se termina aquí: lo terminan Tailscale Funnel o Cloudflare; Traefik recibe HTTP plano desde el
túnel.

**Si falla.** Aunque `web`, `api`, `db` y el resto sigan vivos, la aplicación deja de ser
accesible desde `http://127.0.0.1:8080` y desde las URLs públicas. Es un punto único de entrada,
no un componente de datos.

**Verificación.**

```bash
curl -I http://127.0.0.1:8080/
curl -s http://127.0.0.1:8080/api/events | head
docker compose logs --tail=50 traefik
```

---

### 4.2 `cloudflared` — túnel HTTPS de respaldo

| Dato | Valor |
|---|---|
| Contenedor | `tiquart-cloudflared-1` |
| Imagen | `cloudflare/cloudflared:latest` |
| Perfil | `tunnel` |
| Red | `tiquart_default` (IP observada `172.18.0.8`) |
| Puertos | ninguno publicado |
| Depende de | `traefik` |
| Healthcheck | no definido |
| Reinicio | `unless-stopped` |

**Qué es.** Es el cliente de Cloudflare Tunnel. En modalidad *quick tunnel* abre una conexión
saliente hacia la red de Cloudflare y expone un nombre `*.trycloudflare.com` sin necesidad de
cuenta ni dominio propio.

**Qué hace en Tiquart.** Es el **ingress público de respaldo**. Su comando es:

```text
tunnel --no-autoupdate --protocol http2 --url http://traefik:80
```

Todo el tráfico que llega a la URL de Cloudflare se reenvía a Traefik por HTTP/2. La URL se
genera al arrancar y aparece en los logs; si el contenedor se recrea, la URL cambia.

**Por qué está así.** Tailscale Funnel es el ingress primario y estable. Cloudflare existe para
tener un segundo camino si Funnel falla. Se usa HTTP/2 porque el quick tunnel no siempre negocia
bien HTTP/3 en este entorno. Cloudflare puede amortiguar SSE, por eso el frontend tiene polling
de respaldo cada 4 s.

**Si falla.** Solo se pierde la URL de respaldo. La URL de Funnel, `127.0.0.1:8080` y el resto
del stack siguen funcionando.

**Verificación.**

```bash
docker compose logs cloudflared | grep trycloudflare
make tunnel
make public
```

---

### 4.3 `web` — frontend Next.js

| Dato | Valor |
|---|---|
| Contenedor | `tiquart-web-1` |
| Imagen | build local `tiquart-web` |
| Perfil | base |
| Red | `tiquart_default` (IP observada `172.18.0.6`) |
| Puertos | `3000/tcp` solo interno (`expose`) |
| Depende de | `api` en estado `healthy` |
| Healthcheck | no definido |
| Reinicio | `unless-stopped` |

**Qué es.** Una aplicación Next.js 16.4.3 con React 19.2 y Tailwind CSS 4, construida en una
imagen `node:24-alpine`. En producción ejecuta `next start -p 3000`.

**Qué hace en Tiquart.** Es toda la interfaz que ve el comprador y el personal de la demo:

- `/`: catálogo de eventos, precios y disponibilidad.
- `/eventos/[id]`: mapa de asientos, selección, reserva con contador de 120 s, checkout
  simulado, visualización del QR y escucha SSE para actualizar asientos en vivo.
- `/login`: registro e inicio de sesión; guarda el JWT en `localStorage`.
- `/boletas`: boletas del usuario y sus códigos QR.
- `/admin`: panel de control; pide el token `x-admin-token` y permite reset, métricas,
  validación de QR y *sellout*.
- `/live`: sala de monitoreo con estadísticas globales.

Habla con la API siempre por la ruta relativa `/api`, configurada con
`NEXT_PUBLIC_API_BASE=/api`. Así el navegador llama al mismo origen y Traefik se encarga del
resto.

**Por qué está así.** Al no publicar el puerto `3000`, obliga a pasar por Traefik. El polling
cada 4 s en el mapa de asientos es una red de seguridad para túneles que retienen SSE.

**Si falla.** La audiencia no puede navegar ni comprar desde la interfaz, aunque la API siga
respondiendo. Traefik devolvería error al intentar servir `/`.

**Verificación.**

```bash
curl -I http://127.0.0.1:8080/
docker compose logs --tail=50 web
```

---

### 4.4 `api` — backend FastAPI y lógica del negocio

| Dato | Valor |
|---|---|
| Contenedor | `tiquart-api-1` |
| Imagen | build local `tiquart-api` |
| Perfil | base |
| Red | `tiquart_default` (IP observada `172.18.0.5`) |
| Puertos | `8000/tcp` solo interno (`expose`) |
| Depende de | `db` y `cache` healthy; `mosquitto` iniciado |
| Healthcheck | `GET /health` cada 10 s, 12 reintentos, 20 s de gracia |
| Reinicio | `unless-stopped` |

**Qué es.** Es una API FastAPI sobre Uvicorn, con Python 3.13, SQLAlchemy asíncrono y
`asyncpg`. Incluye autenticación JWT, hashing Argon2, generación de QR, métricas Prometheus y
un cliente MQTT asíncrono.

**Qué hace en Tiquart.** Es el cerebro del sistema. Concentra:

- **Autenticación:** registro, login y JWT.
- **Catálogo:** eventos, detalle y mapa de asientos.
- **Reserva CP:** `POST /holds` ejecuta un único `UPDATE` condicionado sobre `seats`; si otro
  comprador ya tomó el asiento, devuelve `409 seats_unavailable`. La transacción es atómica.
- **Checkout:** valida el hold, aplica el límite de **4 boletas por usuario y evento**, crea
  `orders`, `order_items` y `tickets` en una transacción. El pago es simulado.
- **Boletas y QR:** `GET /orders/mine`, `GET /tickets/mine` y validación de QR con
  `POST /tickets/validate`; un QR ya usado devuelve `409`.
- **SSE:** `/sse/events/{id}` para el mapa de asientos y `/sse/live` para el resumen global.
- **Estadísticas de respaldo:** `/stats/live`, para cuando SSE no llega.
- **Administración:** `/admin/reset`, `/admin/stats` y `/admin/events/{id}/sellout`, protegidos
  con el token de administración.
- **Métricas:** `/metrics` con `prometheus-fastapi-instrumentator` y gauges propios de asientos
  y reservas.
- **Tareas de fondo:** un loop cada 5 s libera holds vencidos y otro publica en MQTT. **No hay
  contenedor worker**: todo corre dentro del proceso de la API con `asyncio`.
- **Seed:** al arrancar crea el esquema con `create_all` y siembra 3 eventos × 120 asientos,
  las cuentas `demo`, `admin` y `preventa`, y las boletas de preventa.

**Barreras contra la doble venta.**

1. `UPDATE seats ... WHERE id IN (...) AND status='available' RETURNING id`; si no actualiza
   todos los asientos pedidos, se revierte con `409`.
2. Índice único `tickets.seat_id`: la base rechaza una segunda boleta para la misma butaca.
3. TTL de 120 s (`HOLD_TTL_SECONDS=120`) y loop de expiración que devuelve los asientos a
   `available`.

**Rate limit.** `POST /holds` y `POST /orders/checkout` usan **cache**: 60 peticiones cada 10 s
por usuario. Si Valkey no responde, el limitador falla abierto y la compra continúa.

**Si falla.** No hay compras, catálogo, SSE ni validación de QR. La web puede cargar el HTML,
pero las llamadas a `/api` fallan. Es el componente más crítico después de PostgreSQL.

**Verificación.**

```bash
curl -s http://127.0.0.1:8080/api/health
curl -s http://127.0.0.1:8080/api/metrics | head
make smoke
make concurrency
docker compose logs --tail=100 api
```

---

### 4.5 `db` — PostgreSQL, fuente de verdad

| Dato | Valor |
|---|---|
| Contenedor | `tiquart-db-1` |
| Imagen | `postgres:18-alpine` |
| Perfil | base |
| Red | `tiquart_default` (IP observada `172.18.0.2`) |
| Puertos | `5432/tcp` solo interno (`expose`) |
| Volumen | `db_data → /var/lib/postgresql` (≈ 66 MB observados) |
| Healthcheck | `pg_isready -U tiquart -d tiquart` cada 5 s, 20 reintentos |
| Reinicio | `unless-stopped` |

**Qué es.** PostgreSQL 18 en Alpine, con un volumen nombrado para que los datos sobrevivan a
reinicios y recreaciones del contenedor.

**Qué hace en Tiquart.** Guarda el estado transaccional completo:

- `users`: compradores y administradores.
- `events`: los 3 eventos de la demo.
- `seats`: 120 asientos por evento, con estado `available`, `held` o `sold`.
- `holds`: reservas temporales con `expires_at`.
- `orders` y `order_items`: la compra y su detalle.
- `tickets`: boletas emitidas, con código único y QR.

**Restricciones importantes.**

- `users.email` es único.
- `(event_id, label)` es único: no puede haber dos asientos `A1` en el mismo evento.
- `tickets.seat_id` es **único**: la última barrera contra la doble venta.
- `tickets.code` es único.
- Índices por evento, estado, hold y orden para que el mapa y el checkout sean rápidos.

**Ajustes del servidor.** `shared_buffers=256MB`, `work_mem=8MB` y `max_connections=60`. Son
valores deliberadamente modestos para un equipo de demo con 9 GB asignados a WSL.

**Por qué está así.** Tiquart es **CP** para asientos y boletas: si la base no puede confirmar
la transacción, la venta se niega antes que arriesgar sobreventa. PostgreSQL serializa los
`UPDATE` concurrentes sobre la misma fila; esa es la garantía central de la demo.

**Si falla.** No se puede comprar ni cargar el catálogo. Los datos siguen en `db_data`; un
reinicio del contenedor no los borra. `make reset` no elimina el volumen: trunca y vuelve a
sembrar los datos.

**Verificación.**

```bash
docker compose exec -T db pg_isready -U tiquart -d tiquart
docker compose logs --tail=50 db
# Conteo de boletas por estado:
docker compose exec -T db psql -U tiquart -d tiquart -c "select status, count(*) from tickets group by status;"
```

---

### 4.6 `cache` — Valkey para rate limiting

| Dato | Valor |
|---|---|
| Contenedor | `tiquart-cache-1` |
| Imagen | `valkey/valkey:9-alpine` |
| Perfil | base |
| Red | `tiquart_default` (IP observada `172.18.0.4`) |
| Puertos | `6379/tcp` solo interno (`expose`) |
| Volumen | ninguno |
| Healthcheck | `valkey-cli ping` cada 5 s, 20 reintentos |
| Reinicio | `unless-stopped` |

**Qué es.** Valkey es un fork compatible con Redis, usado aquí como almacén efímero en memoria.
Arranca con `--save "" --appendonly no`, es decir, **sin persistencia**, y con
`--maxmemory 96mb --maxmemory-policy allkeys-lru`.

**Qué hace en Tiquart.** Implementa el **rate limit** de la API. Por cada usuario y ventana de
10 s incrementa una clave `rl:{user_id}:{bucket}` y le pone expiración. Si supera 60 peticiones,
la API responde `429 rate_limited`.

También sirve como ejemplo de dependencia **AP**: si Valkey cae, la compra no se bloquea; el
limitador falla abierto y solo se pierde la protección contra ráfagas.

**Por qué está así.** Es un dato desechable. No necesita volumen ni persistencia; el límite se
recalcula solo. El límite de 96 MB y la política LRU evitan que el contenedor crezca sin control.

**Si falla.** La tienda sigue funcionando; solo se desactiva el rate limiting. Es el contenedor
que menos afecta al negocio.

**Verificación.**

```bash
docker compose exec -T cache valkey-cli ping
docker compose logs --tail=50 cache
```

---

### 4.7 `mosquitto` — broker MQTT de eventos

| Dato | Valor |
|---|---|
| Contenedor | `tiquart-mosquitto-1` |
| Imagen | `eclipse-mosquitto:2` |
| Perfil | base |
| Red | `tiquart_default` (IP observada `172.18.0.3`) |
| Puertos | `1883/tcp` MQTT y `9001/tcp` MQTT sobre WebSocket |
| Volumen | `./infra/mosquitto/mosquitto.conf` montado read-only |
| Healthcheck | no definido |
| Reinicio | `unless-stopped` |

**Qué es.** Eclipse Mosquitto es un broker MQTT ligero. La configuración de la demo abre dos
listeners: `1883` para MQTT normal y `9001` con `protocol websockets` para clientes de navegador.
No hay autenticación (`allow_anonymous true`) ni persistencia (`persistence false`).

**Qué hace en Tiquart.** Es el canal de notificaciones **best-effort** de la API. Cuando un
asiento cambia de estado, la API publica en:

```text
tiquart/event/{event_id}
```

con mensajes como:

```json
{"type":"seats","event_id":1,"seats":[{"id":1,"status":"held"}]}
{"type":"reset","event_id":1}
{"type":"expired","event_id":1}
```

Los suscriptores externos, como `make live` o `mosquitto_sub`, ven la compra en vivo. El
frontend **no** depende de MQTT: usa SSE contra la API. MQTT es para demostrar mensajería
distribuida y para proyectar los eventos en terminal.

> El resumen global `/live` se sirve por SSE/HTTP desde la API. El bus actual publica en
> `tiquart/event/{id}`; no hay un topic `tiquart/live` independiente.

**Por qué está así.** Es **AP**: si Mosquitto se cae, las compras siguen. El cliente MQTT de la
API reintenta cada 3 s y encola hasta 2000 mensajes; los que se pierdan mientras el broker está
caído no se recuperan, porque no hay persistencia.

**Si falla.** La compra funciona; `make live` y cualquier suscriptor MQTT quedan mudos. El
sistema se recupera solo cuando Mosquitto vuelve.

**Verificación.**

```bash
make live
# o:
mosquitto_sub -h 127.0.0.1 -t 'tiquart/#' -v
make rubric-check
```

---

### 4.8 `prometheus` — recolección y consulta de métricas

| Dato | Valor |
|---|---|
| Contenedor | `tiquart-prometheus-1` |
| Imagen | `prom/prometheus:latest` |
| Perfil | `obs` |
| Red | `tiquart_default` (IP observada `172.18.0.10`) |
| Puertos | `127.0.0.1:9090 → 9090/tcp` |
| Volumen | `prom_data → /prometheus` (≈ 250 MB observados) |
| Depende de | ninguno |
| Healthcheck | no definido |
| Reinicio | `unless-stopped` |

**Qué es.** Prometheus es una base de datos de series temporales con modelo *pull*: él mismo
consulta periódicamente a los servicios que exponen `/metrics`.

**Qué hace en Tiquart.** Cada **5 segundos** scrapea cuatro objetivos definidos en
`infra/prometheus/prometheus.yml`:

| Job | Objetivo | Qué aporta |
|---|---|---|
| `api` | `api:8000/metrics` | peticiones HTTP, latencias, errores y gauges de asientos |
| `cadvisor` | `cadvisor:8080` | CPU/RAM por contenedor |
| `node` | `node-exporter:9100` | CPU/RAM/red/disco del host WSL |
| `prometheus` | `localhost:9090` | salud del propio Prometheus |

Guarda **6 horas** de historia (`--storage.tsdb.retention.time=6h`) y permite recarga en
caliente (`--web.enable-lifecycle`). Es la fuente de datos de Grafana.

**Por qué está así.** Permite mostrar métricas reales sin depender de un SaaS. El intervalo de
5 s da una resolución suficiente para una demo de 15 minutos sin llenar el disco.

**Si falla.** Grafana se queda sin datos y las consultas históricas fallan, pero la tienda sigue
vendiendo. Es observabilidad, no camino crítico.

**Verificación.**

```bash
curl -s http://127.0.0.1:9090/-/ready
curl -s http://127.0.0.1:9090/api/v1/targets | head
curl -s 'http://127.0.0.1:9090/api/v1/query?query=tiquart_seats_sold'
make obs-check
```

---

### 4.9 `grafana` — dashboards de la demo

| Dato | Valor |
|---|---|
| Contenedor | `tiquart-grafana-1` |
| Imagen | `grafana/grafana:latest` |
| Perfil | `obs` |
| Red | `tiquart_default` (IP observada `172.18.0.11`) |
| Puertos | `127.0.0.1:3001 → 3000/tcp` |
| Volúmenes | provisioning y dashboards read-only; `grafana_data → /var/lib/grafana` |
| Depende de | `prometheus` |
| Healthcheck | no definido |
| Reinicio | `unless-stopped` |

**Qué es.** Grafana es la capa de visualización. Se aprovisiona automáticamente con un
datasource y un dashboard, sin configurar nada a mano.

**Qué hace en Tiquart.** Muestra el dashboard **“Tiquart · Demo en vivo”** con 8 paneles:

1. CPU por contenedor (%).
2. RAM por contenedor (MB).
3. Peticiones por segundo.
4. Latencia p95 (s).
5. Errores 5xx / 4xx.
6. Boletas vendidas.
7. Reservas activas.
8. Asientos disponibles.

El datasource `Prometheus` apunta a `http://prometheus:9090` y es el predeterminado. El
provisioning se monta read-only; el estado de usuarios y preferencias vive en `grafana_data`.
El registro público está deshabilitado (`GF_USERS_ALLOW_SIGN_UP=false`) y el acceso es
`admin` / contraseña definida en `.env` (documentada en `DEMO.md`).

**Por qué está así.** Es la forma más clara de mostrar en la sustentación que los recursos se
consumen de verdad y que la API es el cuello de botella bajo carga.

**Si falla.** No hay dashboard, pero la compra y la API siguen intactas.

**Verificación.**

```bash
curl -I http://127.0.0.1:3001/login
make obs-check
```

---

### 4.10 `cadvisor` — métricas por contenedor

| Dato | Valor |
|---|---|
| Contenedor | `tiquart-cadvisor-1` |
| Imagen | `gcr.io/cadvisor/cadvisor:latest` |
| Perfil | `obs` |
| Red | `tiquart_default` (IP observada `172.18.0.9`) |
| Puertos | `8080/tcp` solo interno (`expose`) |
| Volúmenes | `/`, `/var/run`, `/sys`, `/var/lib/docker`, `/dev/disk` en read-only |
| Dispositivo | `/dev/kmsg` |
| Healthcheck | definido por la imagen (aparece `healthy`) |
| Reinicio | `unless-stopped` |

**Qué es.** cAdvisor es el recolector de métricas de contenedores de Google. Lee cgroups,
metadatos de Docker y estadísticas del sistema para exponer métricas por contenedor.

**Qué hace en Tiquart.** Alimenta a Prometheus con las series que usa el dashboard:

- `container_cpu_usage_seconds_total`: CPU por contenedor.
- `container_memory_working_set_bytes`: RAM por contenedor.
- Red, filesystem y throttling de CPU.

Es la fuente de los paneles “CPU por contenedor” y “RAM por contenedor”.

**Por qué está así.** Necesita `privileged: true`, acceso a `/dev/kmsg` y montajes read-only del
host para poder leer cgroups y el estado de Docker. Es potente pero intrusivo: no se publica al
host y es aceptable solo en una demo controlada.

**Si falla.** Los paneles por contenedor quedan vacíos; el resto de la observabilidad y la
tienda siguen funcionando.

**Verificación.**

```bash
docker compose logs --tail=50 cadvisor
curl -s http://127.0.0.1:9090/api/v1/query?query=container_memory_working_set_bytes
```

---

### 4.11 `node-exporter` — métricas del host WSL

| Dato | Valor |
|---|---|
| Contenedor | `tiquart-node-exporter-1` |
| Imagen | `prom/node-exporter:latest` |
| Perfil | `obs` |
| Red | `tiquart_default` (IP observada `172.18.0.12`) |
| Puertos | `9100/tcp` solo interno (`expose`) |
| Volumen | `/ → /host:ro` |
| PID | `host` |
| Healthcheck | no definido |
| Reinicio | `unless-stopped` |

**Qué es.** El exporter oficial de Prometheus para métricas del sistema operativo. Se ejecuta
con el namespace de PID del host y monta la raíz del host en `/host` para leer
`--path.rootfs=/host`.

**Qué hace en Tiquart.** Aporta la visión del **host WSL**: CPU total, memoria, carga media,
disco, red, filesystem y presión de recursos. Complementa a cAdvisor: cAdvisor dice cuánto
consume cada contenedor; node-exporter dice cuánto consume el conjunto y si el host está
saturado.

**Por qué está así.** Sin él, el dashboard solo tendría métricas de contenedores y no podría
explicar si el límite es del host (9 GB, 6 vCPU) o de un servicio concreto.

**Si falla.** Se pierden los paneles del host; la tienda y las métricas por contenedor siguen.

**Verificación.**

```bash
curl -s http://127.0.0.1:9090/api/v1/query?query=node_memory_MemAvailable_bytes
make obs-check
```

---

### 4.12 `portainer` — administración de Docker

| Dato | Valor |
|---|---|
| Contenedor | `tiquart-portainer-1` |
| Imagen | `portainer/portainer-ce:latest` |
| Perfil | `rubric` |
| Red | `tiquart_default` (IP observada `172.18.0.15`) |
| Puertos | `127.0.0.1:9000 → 9000/tcp` |
| Volúmenes | `/var/run/docker.sock` y `portainer_data → /data` (≈ 526 kB) |
| Healthcheck | no definido |
| Reinicio | `unless-stopped` |

**Qué es.** Portainer CE es una interfaz web para administrar Docker: contenedores, imágenes,
redes, volúmenes, logs, consola y estadísticas de uso.

**Qué hace en Tiquart.** Es uno de los cinco servicios de la rúbrica. Sirve para demostrar en
vivo que los 15 contenedores están corriendo, ver sus logs y mostrar el estado del stack desde
una interfaz gráfica. Tiene un usuario administrador ya inicializado y persistido en
`portainer_data`.

**Por qué está así.** El socket de Docker se monta **read-write** porque Portainer necesita
poder iniciar, detener y recrear contenedores. Es equivalente a acceso root sobre Docker, por eso
el puerto se publica solo en `127.0.0.1` y no se expone por los túneles públicos.

**Si falla.** El stack y la tienda siguen funcionando; solo se pierde la consola de
administración.

**Verificación.**

```bash
curl -I http://127.0.0.1:9000/
make rubric-check
```

Credenciales: `admin` / `Tiquart2026!` (también en `DEMO.md`).

---

### 4.13 `glances` — monitor de recursos en tiempo real

| Dato | Valor |
|---|---|
| Contenedor | `tiquart-glances-1` |
| Imagen | `nicolargo/glances:latest-full` |
| Perfil | `rubric` |
| Red | `tiquart_default` (IP observada `172.18.0.14`) |
| Puertos | `127.0.0.1:61208 → 61208/tcp` |
| Volúmenes | `/var/run/docker.sock:ro` y `/ → /host:ro` |
| PID | `host` |
| Healthcheck | no definido |
| Reinicio | `unless-stopped` |

**Qué es.** Glances es un monitor de sistema multiplataforma. En modo web (`GLANCES_OPT="-w"`)
sirve una interfaz que muestra CPU, memoria, swap, red, disco, procesos y sensores.

**Qué hace en Tiquart.** Es el segundo servicio de la rúbrica. Con `pid: host`, el socket de
Docker en read-only y la raíz del host montada, puede mostrar tanto el estado del host WSL como
la lista de contenedores. Es útil para la narrativa de “consumo de recursos en vivo” sin depender
de Grafana.

**Por qué está así.** El modo web evita instalar nada en Windows. El socket read-only reduce el
riesgo: Glances puede ver los contenedores, pero no modificarlos.

**Si falla.** Se pierde el panel de monitoreo rápido; la tienda y Grafana siguen.

**Verificación.**

```bash
curl -I http://127.0.0.1:61208/
make rubric-check
```

---

### 4.14 `wg-easy` — servidor WireGuard y panel VPN

| Dato | Valor |
|---|---|
| Contenedor | `tiquart-wg-easy-1` |
| Imagen | `ghcr.io/wg-easy/wg-easy:latest` |
| Perfil | `rubric` |
| Red | `tiquart_default` (IP observada `172.18.0.13`) |
| Puertos | `0.0.0.0:51820/udp` y `127.0.0.1:51821 → 51821/tcp` |
| Volumen | `wg_data → /etc/wireguard` (≈ 841 B) |
| Capacidades | `NET_ADMIN`, `SYS_MODULE` |
| Sysctls | `net.ipv4.conf.all.src_valid_mark=1`, `net.ipv4.ip_forward=1` |
| Healthcheck | definido por la imagen (aparece `healthy`) |
| Reinicio | `unless-stopped` |

**Qué es.** WG-Easy es una interfaz web y un servidor WireGuard. Permite crear clientes VPN,
descargar sus configuraciones y ver el estado de las conexiones.

**Qué hace en Tiquart.** Es el servicio de VPN de la rúbrica. Demuestra cómo un dispositivo
remoto podría entrar de forma cifrada a la red del laboratorio. El panel se publica solo en
`127.0.0.1:51821`; el tráfico VPN escucha en `51820/udp`.

Variables relevantes:

- `WG_HOST=demo.tiquart.local`: nombre que se pone en las configuraciones de los clientes.
- `INIT_USERNAME=admin` e `INIT_PASSWORD` desde `.env`: credenciales iniciales del panel.
- `wg_data`: conserva claves y pares entre reinicios.

**Por qué está así.** WireGuard necesita `NET_ADMIN` para crear la interfaz y `SYS_MODULE` para
cargar el módulo; los sysctls permiten el reenvío y el marcado de paquetes. El puerto UDP se
publica porque los clientes deben alcanzarlo; el panel HTTP queda local.

**Si falla.** La VPN y su panel dejan de estar disponibles; la tienda no se ve afectada.

**Verificación.**

```bash
curl -I http://127.0.0.1:51821/
make rubric-check
```

Credenciales del panel: `admin` / `tiquart` (ver `DEMO.md`).

---

### 4.15 `samba` — carpeta compartida SMB

| Dato | Valor |
|---|---|
| Contenedor | `tiquart-samba-1` |
| Imagen | `dperson/samba:latest` |
| Perfil | `rubric` |
| Red | `tiquart_default` (IP observada `172.18.0.16`) |
| Puertos | `1139 → 139/tcp` y `1445 → 445/tcp` |
| Volumen | `./infra/samba/share → /mount/compartido` |
| Usuario | `tiquart` / `tiquart` |
| Share | `Compartido`, visible y escribible por `tiquart`, sin invitados |
| Healthcheck | `smbclient -L \\localhost -U % -m SMB3` (definido por la imagen) |
| Reinicio | `unless-stopped` |

**Qué es.** Samba implementa el protocolo SMB/CIFS para compartir archivos con Windows. El
contenedor usa la imagen `dperson/samba`, que genera la configuración a partir de argumentos.

**Qué hace en Tiquart.** Es el servicio de archivos de la rúbrica. Publica el share
`Compartido`, que apunta a la carpeta real del proyecto:

```text
~/projects/Tiquart/infra/samba/share
```

El usuario `tiquart` puede leer y escribir; los invitados están deshabilitados.

**Por qué usa los puertos 1139/1445.** WSL corre con `networkingMode=mirrored` y el servicio
LanmanServer de Windows ya ocupa `139` y `445`. Docker no puede publicar esos puertos en el
host. Dentro del contenedor SMB sigue escuchando en `139/445`; hacia el host se mapea
`1139→139` y `1445→445`.

**Cómo se accede.**

Desde WSL (verificado):

```bash
smbclient //172.18.0.16/Compartido -U "tiquart%tiquart" -c "ls"
```

Desde Windows 11 24H2 o superior (puerto alternativo):

```powershell
New-SmbMapping -LocalPath Z: -RemotePath '\\127.0.0.1\Compartido' `
  -TcpPort 1445 -UserName 'tiquart' -Password 'tiquart' -Persistent $false
```

Desde el Explorador, la vía más simple es abrir la carpeta real de WSL:

```text
\\wsl.localhost\Ubuntu\home\cristian\projects\Tiquart\infra\samba\share
```

**Limitación conocida.** `net use \\127.0.0.1@1445\Compartido` falla con error 67: Windows
interpreta `127.0.0.1@1445` como nombre de servidor, no como host + puerto. Para un puerto
alternativo hay que usar `New-SmbMapping -TcpPort 1445`, o acceder por la ruta de WSL.

**Si falla.** El share deja de estar disponible; la tienda no se ve afectada.

**Verificación.**

```bash
smbclient -L 127.0.0.1 -p 1445 -N
make rubric-check
```

---

## 5. Mapa de puertos

### Publicados en el host

| Puerto host | Contenedor | Servicio | Interfaz | Para qué |
|---|---|---|---|---|
| `8080/tcp` | `traefik:80` | Traefik | todas | Entrada de la app; Funnel lo publica en HTTPS |
| `1883/tcp` | `mosquitto:1883` | Mosquitto | todas | MQTT para `make live` y clientes |
| `9001/tcp` | `mosquitto:9001` | Mosquitto | todas | MQTT sobre WebSocket |
| `3001/tcp` | `grafana:3000` | Grafana | `127.0.0.1` | Dashboard |
| `9090/tcp` | `prometheus:9090` | Prometheus | `127.0.0.1` | Consultas y targets |
| `9000/tcp` | `portainer:9000` | Portainer | `127.0.0.1` | Administración Docker |
| `61208/tcp` | `glances:61208` | Glances | `127.0.0.1` | Monitor del sistema |
| `51820/udp` | `wg-easy:51820` | WG-Easy | todas | WireGuard |
| `51821/tcp` | `wg-easy:51821` | WG-Easy | `127.0.0.1` | Panel VPN |
| `1139/tcp` | `samba:139` | Samba | todas | SMB NetBIOS |
| `1445/tcp` | `samba:445` | Samba | todas | SMB moderno |

### Solo internos (`expose`)

| Puerto | Contenedor | Servicio | Quién lo consume |
|---|---|---|---|
| `3000/tcp` | `web` | Next.js | Traefik |
| `8000/tcp` | `api` | FastAPI | Traefik, Prometheus |
| `5432/tcp` | `db` | PostgreSQL | API |
| `6379/tcp` | `cache` | Valkey | API |
| `8080/tcp` | `cadvisor` | cAdvisor | Prometheus |
| `9100/tcp` | `node-exporter` | node-exporter | Prometheus |

`cloudflared` no publica puertos: solo abre conexiones salientes hacia Cloudflare.

---

## 6. Red Docker

Todos los contenedores comparten la red bridge `tiquart_default` (`172.18.0.0/16`). Docker
incluye DNS interno: un contenedor puede llamar a otro por su **nombre de servicio**
(`api`, `web`, `db`, `cache`, `mosquitto`, `prometheus`, etc.), sin usar IPs.

IPs observadas al momento de este documento:

| Contenedor | IP |
|---|---|
| `db` | `172.18.0.2` |
| `mosquitto` | `172.18.0.3` |
| `cache` | `172.18.0.4` |
| `api` | `172.18.0.5` |
| `web` | `172.18.0.6` |
| `traefik` | `172.18.0.7` |
| `cloudflared` | `172.18.0.8` |
| `cadvisor` | `172.18.0.9` |
| `prometheus` | `172.18.0.10` |
| `grafana` | `172.18.0.11` |
| `node-exporter` | `172.18.0.12` |
| `wg-easy` | `172.18.0.13` |
| `glances` | `172.18.0.14` |
| `portainer` | `172.18.0.15` |
| `samba` | `172.18.0.16` |

Las IPs **pueden cambiar** si se recrean los contenedores. Para el día de la demo, lo estable
es el nombre de servicio, no la IP.

---

## 7. Volúmenes y persistencia

| Volumen / montaje | Contenedor | Ruta | Contenido | Tamaño observado |
|---|---|---|---|---|
| `tiquart_db_data` | `db` | `/var/lib/postgresql` | Base de datos completa | ≈ 66 MB |
| `tiquart_prom_data` | `prometheus` | `/prometheus` | Series temporales (6 h) | ≈ 250 MB |
| `tiquart_grafana_data` | `grafana` | `/var/lib/grafana` | Usuarios, preferencias, estado | ≈ 318 MB |
| `tiquart_portainer_data` | `portainer` | `/data` | Configuración y admin | ≈ 526 kB |
| `tiquart_wg_data` | `wg-easy` | `/etc/wireguard` | Claves y pares VPN | ≈ 841 B |
| `./infra/samba/share` | `samba` | `/mount/compartido` | Archivos compartidos | bind mount |
| `./infra/mosquitto/mosquitto.conf` | `mosquitto` | `/mosquitto/config/mosquitto.conf` | Configuración | read-only |
| `./infra/traefik` | `traefik` | `/etc/traefik/dynamic` | Routing | read-only |
| `./infra/prometheus/prometheus.yml` | `prometheus` | `/etc/prometheus/prometheus.yml` | Scrape config | read-only |
| `./infra/grafana/provisioning` | `grafana` | `/etc/grafana/provisioning` | Datasource y dashboards | read-only |
| `./infra/grafana/dashboards` | `grafana` | `/var/lib/grafana/dashboards` | Dashboard `tiquart.json` | read-only |

**Sin persistencia deliberada:**

- `cache`: el rate limit es efímero.
- `mosquitto`: `persistence false`; los mensajes no se guardan.
- `web` y `api`: son stateless; el estado vive en PostgreSQL.
- `cadvisor`, `node-exporter`, `glances`: solo leen el host.

`docker compose down` **no** borra los volúmenes. `docker compose down -v` sí los elimina; no
lo uses antes de la demo si quieres conservar datos.

---

## 8. Orden de arranque y healthchecks

```
db (healthy) ─┐
cache (healthy) ─┼──► api (healthy) ──► web ──► traefik
mosquitto (started) ─┘                              │
                                                    └──► cloudflared (perfil tunnel)

prometheus ──► grafana
portainer, glances, wg-easy, samba: independientes
k6 (perfil load) ──► api (healthy)
```

| Contenedor | Healthcheck | Detalle |
|---|---|---|
| `db` | sí | `pg_isready` cada 5 s, 20 reintentos |
| `cache` | sí | `valkey-cli ping` cada 5 s, 20 reintentos |
| `api` | sí | `GET /health` cada 10 s, 12 reintentos, 20 s de gracia |
| `samba` | sí | definido por la imagen; `smbclient -L` cada 60 s |
| `cadvisor` | sí | definido por la imagen |
| `wg-easy` | sí | definido por la imagen |
| `web`, `traefik`, `mosquitto`, `cloudflared`, `prometheus`, `grafana`, `portainer`, `glances`, `node-exporter` | no | se controlan por logs y pruebas funcionales |

Un healthcheck de Docker solo prueba el proceso. La verificación real del negocio es
`make smoke` (compra completa + QR) y `make concurrency` (40 compradores por el mismo asiento).

---

## 9. Consumo observado

Instantánea con la demo en reposo, sin compradores, tomada con `docker stats --no-stream`:

| Contenedor | CPU | RAM |
|---|---:|---:|
| `grafana` | 1.79 % | 398.0 MiB |
| `prometheus` | 9.11 % | 241.2 MiB |
| `cadvisor` | 2.11 % | 143.1 MiB |
| `db` | 0.94 % | 115.9 MiB |
| `glances` | 1.15 % | 106.7 MiB |
| `api` | 3.27 % | 80.5 MiB |
| `web` | 0.00 % | 75.0 MiB |
| `traefik` | 0.06 % | 31.5 MiB |
| `cloudflared` | 0.00 % | 30.5 MiB |
| `wg-easy` | 0.00 % | 19.9 MiB |
| `portainer` | 0.04 % | 19.3 MiB |
| `cache` | 0.29 % | 12.6 MiB |
| `node-exporter` | 0.00 % | 11.2 MiB |
| `mosquitto` | 0.04 % | 10.9 MiB |
| `samba` | 0.00 % | 5.4 MiB |

**Total aproximado:** ≈ **1.27 GiB** de RAM y muy poco CPU en reposo. WSL está limitado a
9 GB, 6 CPU y 4 GB de swap (`.wslconfig`). Durante `make load` con 60 VUs, la API puede llegar
a ~274 % de CPU (≈ 3 núcleos) y Prometheus/cAdvisor también suben por el scraping.

---

## 10. Matriz de fallos: qué se rompe y qué no

| Si se cae… | Efecto inmediato | ¿Se puede comprar? |
|---|---|---|
| `traefik` | No se llega a la app por `8080` ni por los túneles | No |
| `web` | No hay interfaz, aunque la API siga viva | No desde la UI |
| `api` | No hay catálogo, reservas, checkout, QR ni SSE | No |
| `db` | No hay fuente de verdad ni transacciones | No |
| `cache` | Se desactiva el rate limit; todo lo demás sigue | **Sí** |
| `mosquitto` | `make live` no muestra eventos; la API reintenta | **Sí** |
| `cloudflared` | Se pierde la URL de respaldo; Funnel sigue | **Sí** |
| `prometheus` | No hay histórico ni datos para Grafana | **Sí** |
| `grafana` | No hay dashboard | **Sí** |
| `cadvisor` | No hay CPU/RAM por contenedor | **Sí** |
| `node-exporter` | No hay métricas del host | **Sí** |
| `portainer` | No hay consola de administración Docker | **Sí** |
| `glances` | No hay monitor rápido | **Sí** |
| `wg-easy` | No hay VPN ni panel VPN | **Sí** |
| `samba` | No hay carpeta compartida | **Sí** |

Esto refleja la decisión de diseño: **CP** para asientos/boletas (`db`, `api`) y **AP** para
catálogo, métricas y notificaciones (`cache`, `mosquitto`, observabilidad, rúbrica).

---

## 11. Seguridad y límites conscientes

- **TLS:** Traefik no termina TLS. Tailscale Funnel y Cloudflare lo hacen antes de llegar al
  puerto `8080`.
- **Paneles administrativos:** Portainer, Grafana, Prometheus y Glances se publican solo en
  `127.0.0.1`, no en los túneles públicos.
- **Docker socket:** Portainer lo monta read-write (equivalente a root sobre Docker); Glances lo
  monta read-only. No es un diseño para producción.
- **cAdvisor:** corre privilegiado y con acceso a `/dev/kmsg`; es necesario para métricas de
  cgroups, pero amplía la superficie de ataque.
- **MQTT:** anónimo y sin persistencia. Cualquiera en la red puede publicar/suscribirse.
- **Samba:** usuario `tiquart`; sin invitados. El montaje por puerto alternativo depende de la
  versión de Windows.
- **Base de datos:** credenciales internas (`tiquart`/`tiquart`) y puerto no publicado.
- **Pago:** simulado; no hay pasarela real ni cumplimiento PCI.
- **Sin worker ni colas:** los loops de expiración y MQTT viven dentro de la API. Si se escala
  la API a varias réplicas, el bus SSE en memoria no se comparte; habría que moverlo a Valkey
  Pub/Sub, NATS o similar.
- **Sin Alembic:** el esquema se crea con `create_all` y el seed es idempotente; suficiente para
  datos desechables de demo.
- **Un solo host:** no hay alta disponibilidad real. La demo muestra consistencia y tolerancia
  a fallos parciales, no un clúster de producción.

---

## 12. `k6`: el servicio opcional que no cuenta entre los 15

| Dato | Valor |
|---|---|
| Contenedor | `tiquart-k6-1` (solo cuando se ejecuta) |
| Imagen | `grafana/k6:latest` |
| Perfil | `load` |
| Red | `tiquart_default` |
| Puertos | ninguno |
| Volumen | `./load → /scripts:ro` |
| Depende de | `api` healthy |

**Qué hace.** Ejecuta `load/k6-seats.js` con 60 usuarios virtuales que compiten por asientos.
`make load` primero hace `reset`, luego corre k6 y muestrea CPU/RAM con `docker stats`. No forma
parte de los 15 contenedores de la demo; se levanta solo para la prueba de capacidad.

---

## 13. Comandos rápidos de operación

```bash
# Ver los 15 contenedores y su estado
docker compose ps
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'

# Consumo en vivo
docker stats

# Red e IPs
docker network inspect tiquart_default

# Volúmenes
docker volume ls --filter name=tiquart
docker system df -v

# Verificación funcional
make smoke          # compra + QR
make concurrency    # 40 compradores, mismo asiento
make public         # rutas por Funnel
make public-smoke   # compra por la URL pública
make obs-check      # Prometheus + Grafana
make rubric-check   # Portainer, Glances, WG-Easy, Samba, MQTT

# Operación diaria
make reset          # vuelve a sembrar demo/admin/preventa
make url            # URL pública activa
make live           # consola MQTT
```

---

## 14. Referencias internas

- `compose.yml`: definición completa de servicios, perfiles, puertos y volúmenes.
- `infra/traefik/dynamic.yml`: routing `/` y `/api`.
- `infra/prometheus/prometheus.yml`: jobs de scraping.
- `infra/grafana/dashboards/tiquart.json`: dashboard de la demo.
- `infra/mosquitto/mosquitto.conf`: listeners MQTT y WebSocket.
- `backend/app/main.py`: lifespan, seed, loops de expiración y MQTT.
- `backend/app/routers/`: auth, eventos, holds, órdenes, tickets, admin, SSE y stats.
- `DEMO.md`: credenciales, guion de 15 minutos y checklist previo.
- `README.md`: arquitectura, operación y solución de problemas.

---

**Resumen final:** Tiquart usa 15 contenedores para separar responsabilidades: 2 de entrada
(Traefik y Cloudflare), 4 de aplicación y datos (web, API, PostgreSQL, Valkey), 1 de mensajería
(Mosquitto), 4 de observabilidad (Prometheus, Grafana, cAdvisor, node-exporter) y 4 de la
rúbrica (Portainer, Glances, WG-Easy, Samba). El camino crítico de la compra está en API +
PostgreSQL; todo lo demás puede fallar sin provocar sobreventa.
