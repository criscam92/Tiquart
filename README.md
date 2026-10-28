# Tiquart — venta de boletas sin doble venta

Demo funcional de venta de entradas para conciertos, sinfónica, teatro, danza y stand-up.
En esta demo se siembran **3 eventos** (rock sinfónico, stand-up y ballet folklórico), 120
butacas cada uno. El público entra desde el celular con un link, elige una butaca, la reserva
por 2 minutos y paga con un checkout simulado. La base **nunca** entrega el mismo asiento dos
veces.

> **Stack:** Ubuntu WSL 2 + Docker Engine + FastAPI + PostgreSQL 18 + Next.js 16 + Tailwind 4
> **Idea de arquitectura:** núcleo **CP** (asientos) con bordes **AP** (catálogo, caché, mensajería, monitores).

---

## 1. Qué se demuestra

| Concepto del curso | Dónde se ve en Tiquart |
|---|---|
| Contenedores y orquestación | 15 contenedores en `compose.yml`, perfiles `obs`, `rubric`, `tunnel`, `load` |
| Consistencia y tolerancia a particiones | Reserva atómica de asientos (CP) + catálogo/caché/métricas (AP) |
| Exclusión mutua distribuida | `UPDATE ... WHERE status = 'available'` + índice único `tickets.seat_id` |
| Mensajería asíncrona | Mosquitto MQTT publica cada cambio de asiento en `tiquart/event/{id}` |
| Tiempo real | SSE hacia el navegador + *polling* de respaldo cuando un proxy retiene el stream |
| Balanceo / ingress | Traefik enruta `/api` al backend y `/` al frontend |
| Observabilidad | Prometheus + Grafana + cAdvisor + node-exporter + Glances |
| Servicios de la rúbrica | Portainer, Mosquitto, Glances, WG-Easy, Samba |
| Acceso público | Tailscale Funnel (URL estable, SSE real) + Cloudflare como respaldo |

Datos sembrados: **3 eventos × 120 asientos = 360 butacas**, 8 asientos pre-vendidos por evento
para que el mapa no arranque vacío.

---

## 2. Arquitectura

```
                       ┌──────────────────────────────┐
   celular del         │  Tailscale Funnel (primario) │
   compañero  ────────►│  https://…taile80b95.ts.net  │
                       │  Cloudflare (respaldo)       │
                       └──────────────┬───────────────┘
                                      │ HTTP
                       ┌──────────────▼───────────────┐
                       │  Traefik :8080 (host)        │
                       │  /      → web:3000           │
                       │  /api   → api:8000 (strip)   │
                       └───────┬──────────────┬───────┘
                               │              │
                    ┌──────────▼───┐   ┌──────▼────────┐
                    │ Next.js (web)│   │ FastAPI (api) │
                    │ React 19     │   │ asyncpg       │
                    └──────────────┘   └──┬─────┬──────┘
                                          │     │
                       ┌──────────────────▼┐  ┌─▼────────────────┐
                       │ PostgreSQL 18     │  │ Valkey/Redis     │
                       │ fuente de verdad  │  │ rate limit       │
                       └───────────────────┘  └──────────────────┘
                                          │
                       ┌──────────────────▼──────────────────────┐
                       │ Mosquitto MQTT :1883/:9001              │
                       │ tiquart/event/{id}  ·  tiquart/live      │
                       └──────────────────┬──────────────────────┘
                                          │
              ┌───────────────────────────┼───────────────────────────┐
              │                           │                           │
      ┌───────▼────────┐        ┌─────────▼────────┐        ┌────────▼────────┐
      │ Prometheus     │        │ Grafana :3001    │        │ mosquitto_sub   │
      │ cAdvisor       │        │ dashboard        │        │ (terminal demo) │
      │ node-exporter  │        │ tiquart-main     │        └─────────────────┘
      └────────────────┘        └──────────────────┘
```

### Decisión CP / AP

- **CP — asientos y boletas.** Una reserva o venta ocurre dentro de una transacción SQL.
  Si hay partición entre API y PostgreSQL, la operación falla (409/503); preferimos negar la
  venta antes que arriesgar sobreventa.
- **AP — catálogo, métricas, notificaciones.** El listado de eventos, el resumen del panel y los
  mensajes MQTT pueden llegar con retraso sin romper la compra. El frontend tolera datos viejos
  y se recupera con *polling*.

### Cómo se evita la doble venta (3 barreras)

1. **Reserva atómica.** `holds.py` ejecuta un solo `UPDATE` condicionado:

   ```sql
   UPDATE seats
      SET status = 'held', hold_id = :hold, expires_at = :ttl
    WHERE id IN (:ids) AND status = 'available'
   RETURNING id;
   ```

   Si `len(rows) != len(seat_ids)`, la transacción se revierte con `409 seats_unavailable`.
   Dos compradores simultáneos no pueden actualizar la misma fila: PostgreSQL serializa el
   `UPDATE` y el segundo ve `status = 'held'`.

2. **Restricción única.** `tickets.seat_id` es `UNIQUE`; aunque un bug intentara crear dos
   boletas para la misma butaca, la base rechaza la segunda.

3. **TTL y liberación.** Las reservas vencen a los **120 s** (`HOLD_TTL_SECONDS`). Un loop de
   expiración devuelve los asientos a `available` y publica el cambio por MQTT.

**Prueba:** `make concurrency` lanza 40 compradores por el mismo asiento.
Resultado esperado:

```
éxitos: 1 | conflictos: 39 | otros: []
VEREDICTO: OK sin sobreventa
```

---

## 3. Arranque rápido

Requisitos: Ubuntu WSL 2 con Docker Engine + Compose, `make`, `curl`, `mosquitto-clients`.
Todo corre dentro de WSL; no hace falta instalar nada en Windows.

```bash
cd ~/projects/Tiquart

cp .env.example .env          # solo la primera vez (si no existe .env)
make up                       # db + cache + mosquitto + api + web + traefik
make obs                      # Prometheus + Grafana + cAdvisor + node-exporter
make rubric                   # Portainer + Glances + WG-Easy + Samba
make tunnel                   # Cloudflare de respaldo (Funnel ya está configurado)
make url                      # URL primaria (Tailscale Funnel) y la guarda en .tunnel-url
```

Comprobaciones:

```bash
make ps           # estado de contenedores
make smoke        # registro → reserva → pago → QR → validación
make obs-check    # Grafana, Prometheus y métricas de la app
make rubric-check # paneles y puertos de la rúbrica + mensaje MQTT real
make public       # rutas públicas y SSE a través del túnel
```

### Puertos en el host

| Puerto | Servicio | Acceso |
|---|---|---|
| `8080` | Traefik (web + API) | **público** por el túnel |
| `3000` | Next.js | solo red interna (Traefik) |
| `8000` | FastAPI | solo red interna (Traefik) |
| `5432` | PostgreSQL | solo red interna |
| `6379` | Valkey/Redis | solo red interna |
| `1883` / `9001` | Mosquitto MQTT | LAN / localhost |
| `9000` | Portainer | `127.0.0.1` |
| `61208` | Glances | `127.0.0.1` |
| `51820/udp` + `51821` | WG-Easy | UDP público + panel local |
| `1139` / `1445` | Samba (host) | LAN |
| `3001` | Grafana | `127.0.0.1` |
| `9090` | Prometheus | `127.0.0.1` |

> En Windows usar **`http://127.0.0.1:8080`**, no `localhost` (resuelve a IPv6 y puede fallar).

---

## 4. Credenciales y rutas

| Recurso | URL | Credenciales |
|---|---|---|
| Tienda | `http://127.0.0.1:8080/` | — |
| Login / registro | `/login` | `demo@tiquart.com` / `demo1234` |
| Admin | `/admin` | token `tiquart-admin` (se ingresa una vez; queda en localStorage) |
| Panel en vivo | `/live` | — |
| Mis boletas | `/boletas` | requiere login |
| Grafana | `http://127.0.0.1:3001` | `admin` / `tiquart` |
| Prometheus | `http://127.0.0.1:9090` | — |
| Portainer | `http://127.0.0.1:9000` | `admin` / `Tiquart2026!` |
| Glances | `http://127.0.0.1:61208` | — |
| WG-Easy | `http://127.0.0.1:51821` | `admin` / `tiquart` |

Usuarios sembrados: comprador `demo@tiquart.com` (`demo1234`), administrador
`admin@tiquart.com` (`admin1234`) y el comprador histórico interno `preventa@tiquart.com`
(sin contraseña útil: solo es dueño de las boletas pre-vendidas). El panel `/admin` usa el
header `x-admin-token`, no el login de comprador.

> Las 8 boletas pre-vendidas de cada evento pertenecen a `preventa`, **no** a `demo`. Así la
> cuenta demo arranca con 0 compras y puede comprar hasta 4 boletas por evento.
>
> Para la audiencia: cada compañero debe usar **“¿No tienes cuenta? Regístrate”** en `/login`.
> El límite es por cuenta y por evento; si todos comparten `demo`, solo los primeros 4 podrán
> comprar en cada evento.

### Flujo de compra

1. `/` lista los 3 eventos.
2. `/eventos/{id}` muestra el mapa (VIP, Preferencia, General), con estado en vivo.
3. El comprador elige hasta **4 butacas**; el backend crea una reserva de **120 s**.
4. El contador se muestra en pantalla; al vencer, las butacas vuelven a `available`.
5. Checkout simulado: nombre + correo. Límite de **4 boletas por usuario y evento**.
6. Se emiten boletas con QR; `/boletas` las muestra.
7. `/admin` valida el QR: primera lectura `200`, segunda `409` (ya usada).
8. `/live` muestra asientos vendidos, reservados y disponibles cada 2 s.

---

## 5. Servicios de la rúbrica

Los 5 servicios pedidos en la guía están en el perfil `rubric`, más el core de Tiquart.
`make rubric-check` verifica paneles, puertos y publica un evento MQTT real.

| Servicio | Puerto guía | Puerto en este host | Nota |
|---|---|---|---|
| Portainer CE | 9000 | `127.0.0.1:9000` | administra los 15 contenedores |
| Mosquitto | 1883 / 9001 | `1883` / `9001` | broker real usado por la app |
| Glances | 61208 | `127.0.0.1:61208` | CPU/RAM/red del host |
| WG-Easy | 51820/udp, 51821 | `51820/udp`, `127.0.0.1:51821` | perfiles WireGuard |
| Samba | 139 / 445 | **1139 / 1445** | Windows ya ocupa 139/445 |

**Por qué Samba usa 1139/1445.** WSL corre con `networkingMode=mirrored`: el servicio
LanmanServer de Windows ya escucha en 139/445. Docker no puede publicar esos puertos. Dentro
del contenedor SMB sigue en 139/445; hacia el host se mapea `1139→139` y `1445→445`.

Credenciales del share: usuario `tiquart`, contraseña `tiquart` (definidas en `compose.yml`,
perfil `rubric`).

Conexión desde Windows:

```powershell
net use Z: \\127.0.0.1@1445\Compartido /user:tiquart tiquart
# o desde el explorador: \\127.0.0.1@1445\Compartido
```

El listado anónimo funciona (`smbclient -L 127.0.0.1 -p 1445 -N`), pero en este host Windows
rechaza el montaje del share por el puerto 1445 (`Error de sistema 67` /
`NT_STATUS_UNSUCCESSFUL`). La conexión SMB con credenciales sí está verificada contra la IP
interna del contenedor:

```bash
smbclient //172.18.0.16/Compartido -U "tiquart%tiquart" -c "ls"
```

Si el jurado pide ver el share, esa es la vía fiable; para montarlo desde Windows habría que
publicar SMB en un puerto 445 libre, cosa que este host no permite con `networkingMode=mirrored`.

Ver MQTT en vivo mientras el público compra:

```bash
make live
# tiquart/event/1 {"type":"seats", ... "status":"held"}
# tiquart/live {"type":"stats","seats":{...}}
```

---

## 6. Observabilidad

- **Grafana** `http://127.0.0.1:3001` → dashboard `tiquart-main`.
- **Prometheus** `http://127.0.0.1:9090` → targets `api`, `cadvisor`, `node-exporter`, `prometheus`.
- Métricas propias: `tiquart_seats_sold`, `tiquart_seats_held`, `tiquart_seats_available`,
  `tiquart_holds_active` (se recalculan como máximo cada 2 s para no castigar la base).
- **cAdvisor** aporta CPU/RAM por contenedor; **node-exporter** aporta CPU/RAM del host WSL.

```bash
make obs-check
curl -s http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=tiquart_seats_sold'
```

---

## 7. Pruebas y resultados

| Comando | Qué prueba | Resultado de referencia |
|---|---|---|
| `make smoke` | flujo completo de compra y QR | todo `200`, QR repetido `409` |
| `make concurrency` | 40 compradores, mismo asiento | 1 éxito, 39 conflictos, sin sobreventa |
| `make load` | 60 VUs, 40 s, checkout real | 737 iteraciones, 1 109 requests, 6.67 % 409 esperados |
| `make sse` | stream SSE directo y por túnel | Funnel transmite SSE; Cloudflare amortigua |
| `make public` | todas las rutas por la URL pública | `200` en `/`, páginas, `/api/events`, `/api/stats/live` |
| `make public-smoke` | compra completa contra la URL pública | registro → reserva → pago → mis boletas |
| `make rubric-check` | 5 servicios de rúbrica + MQTT | paneles OK, mensaje MQTT capturado |

Carga observada en el equipo de demo (Ryzen 5 3500U, 6 vCPU en WSL): pico API **274 % CPU**
(≈ 3 núcleos), cAdvisor 144 %, PostgreSQL 35 %. `p95` del camino crítico ≈ **2.0 s** con 60 VUs;
el umbral de k6 está en 1.5 s, así que el reporte lo marca como fallo esperado de capacidad,
no de corrección. El objetivo de la demo es mostrar el cuello de botella y el escalado horizontal,
no aprobar un SLA de producción.

> `make load` **reinicia los datos** antes de correr. No lo ejecutes mientras el público está
> comprando, o avisa que las boletas de prueba se van a borrar. Después del test: `make reset`.

---

## 8. URL pública

### Tailscale Funnel (activo, URL estable)

Funnel publica Traefik en una URL HTTPS permanente del tailnet y **no amortigua SSE**:

```
https://cristian-pc.taile80b95.ts.net
```

Se habilitó una vez en el panel de Tailscale y el proxy quedó en segundo plano:

```bash
"/mnt/c/Program Files/Tailscale/tailscale.exe" funnel status
# https://cristian-pc.taile80b95.ts.net (Funnel on)
# |-- / proxy http://127.0.0.1:8080
```

Si el equipo se reinicia, Tailscale arranca solo y conserva la configuración. Para recrearla:

```bash
"/mnt/c/Program Files/Tailscale/tailscale.exe" funnel --bg http://127.0.0.1:8080
make url      # prioriza Funnel sobre Cloudflare automáticamente
make public   # rutas + SSE real
```

> **Nota WSL:** MagicDNS resuelve `*.ts.net` a la IP del tailnet, que no sirve el ingress
> dentro de WSL. Por eso `public-check.sh`, `sse-check.sh` y `public-smoke.py` usan DNS público
> (DoH 1.1.1.1) cuando detectan una URL `.ts.net`. Desde el celular o cualquier red externa la
> URL funciona normal.

### Cloudflare quick tunnel (respaldo)

Sigue activo como plan B:

```bash
make tunnel      # recrea cloudflared y espera 12 s
docker compose logs cloudflared | grep trycloudflare   # URL de respaldo
```

La URL cambia si se recrea `cloudflared`. Cloudflare **amortigua SSE**, por eso las páginas
`/eventos/[id]` y `/live` usan *polling* cada 2–4 s como respaldo; el mapa igual se actualiza.

### Alternativa de respaldo

`scripts/ssh-tunnel.sh` usa localhost.run. El stream SSE funciona, pero la URL rota cada pocos
minutos. Solo como plan C.

---

## 9. Operación

```bash
make logs        # logs del API
make ps          # estado
make reset       # trunca y re-siembra: 3 eventos, 360 asientos, usuarios demo
make down        # apaga todo (conserva volúmenes)
docker compose --profile obs --profile rubric --profile tunnel down   # apaga todo
```

Antes de presentar:

```bash
make up && make obs && make rubric && make tunnel
make reset
make smoke && make concurrency
make url
```

Los scripts de verificación están en `scripts/`:

| Script | Uso |
|---|---|
| `reset.sh` | datos limpios vía `POST /admin/reset` |
| `diag.sh` | puertos y conectividad interna |
| `obs-check.sh` | Grafana/Prometheus/métricas |
| `rubric-check.sh` | 5 servicios + MQTT |
| `public-check.sh [url]` | rutas públicas + SSE |
| `public-smoke.py [url]` | compra completa contra la URL pública |
| `sse-check.sh [url]` | solo stream SSE |
| `url.sh` | URL pública actual |
| `load-test.sh` | reset + k6 + pico de CPU/RAM |
| `ssh-tunnel.sh` | túnel localhost.run de respaldo |

---

## 10. Problemas comunes

| Síntoma | Causa / solución |
|---|---|
| `502` o `404` en la URL pública | `docker compose ps`; revisar `funnel status` o recrear el respaldo con `make tunnel` |
| La URL de Funnel no responde | `"/mnt/c/Program Files/Tailscale/tailscale.exe" funnel status`; si Tailscale está apagado, iniciarlo |
| La URL de Cloudflare cambió | normal al recrear `cloudflared`; leerla de los logs otra vez |
| Windows no abre `localhost:8080` | usar `http://127.0.0.1:8080` |
| El mapa no se mueve solo por Cloudflare | ese túnel amortigua SSE; el *polling* de 2–4 s lo cubre (Funnel sí transmite SSE) |
| `make reset` falla | API no está *healthy*: `make ps`, `make logs` |
| Portainer pide crear admin y ya pasó el tiempo | `docker compose --profile rubric restart portainer` y crear el usuario |
| Samba no monta en 139/445 | usar `1139`/`1445`: Windows ya ocupa los puertos originales |
| Samba da error 67 al montar por 1445 | limitación del host con `networkingMode=mirrored`; verificar con `smbclient //172.18.0.16/Compartido -U "tiquart%tiquart" -c "ls"` |
| WG-Easy no levanta | el contenedor necesita `NET_ADMIN`; verificar que Docker de WSL lo permita |
| WSL se queda sin RAM con todo encendido | `.wslconfig`: 9 GB, 6 CPU, swap 4 GB; apagar perfiles que no se usan |
| `p95` de k6 sobre 1.5 s | capacidad del equipo; reducir las etapas de VUs en `load/k6-seats.js` o documentarlo como límite |

---

## 11. Estructura del repositorio

```
Tiquart/
├── backend/
│   ├── app/
│   │   ├── main.py          # lifespan, seed, loops MQTT/expiración
│   │   ├── models.py        # SQLAlchemy: users, events, seats, holds, orders, tickets
│   │   ├── routers/
│   │   │   ├── auth.py      # registro/login JWT
│   │   │   ├── events.py    # catálogo y mapa de asientos
│   │   │   ├── holds.py     # reserva atómica (CP)
│   │   │   ├── orders.py    # checkout, límite de 4, emisión de boletas
│   │   │   ├── tickets.py   # mis boletas + validación QR
│   │   │   ├── sse.py       # stream en vivo
│   │   │   ├── stats.py     # respaldo de polling
│   │   │   └── admin.py     # reset, stats, sellout
│   │   ├── metrics.py       # gauges Prometheus
│   │   ├── bus.py           # MQTT publish/subscribe
│   │   ├── limits.py        # rate limit con Redis
│   │   └── seed.py          # 3 eventos × 120 asientos
│   └── tests/               # smoke.py, concurrency.py
├── frontend/
│   └── app/                 # /, /login, /eventos/[id], /boletas, /admin, /live
├── infra/
│   ├── traefik/             # routing / y /api
│   ├── prometheus/          # scrape config
│   ├── grafana/             # provisioning + dashboard tiquart.json
│   ├── mosquitto/           # broker
│   └── samba/share/         # carpeta compartida
├── load/k6-seats.js         # prueba de carga
├── scripts/                 # operación y verificación
├── compose.yml              # todos los servicios y perfiles
├── Makefile
└── DEMO.md                  # guion minuto a minuto para la sustentación
```

---

## 12. Límites conscientes del alcance

- Pago **simulado**; no hay pasarela real ni PCI.
- Monolito modular FastAPI, no microservicios: menos fallos en una demo de 15 minutos.
- Sin RabbitMQ ni workers: MQTT + loops `asyncio` cubren el fan-out de la demo.
- Sin Alembic: esquema con `create_all` + seed; suficiente para datos desechables.
- Sin WAF/OTP: el objetivo es mostrar consistencia y resource consumption, no producción.
- La URL de Cloudflare es efímera y amortigua SSE; por eso la primaria es Tailscale Funnel.
