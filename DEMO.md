# Guion de sustentación — Tiquart (15 min)

**Fecha:** 27 de octubre de 2026 · **Duración:** 15 min · **Modalidad:** magistral demostrativa
**Objetivo:** que el jurado vea (1) servicios distribuidos activos, (2) compra real desde celulares,
(3) prueba de que no hay sobreventa y (4) consumo de recursos en vivo.

> Regla de oro: **primero se prueba, después se presenta.** A las 08:00 del día, corre el
> checklist de la sección 1 y no cambies nada de código.

**URL pública estable:** https://cristian-pc.taile80b95.ts.net
(el respaldo Cloudflare se obtiene con `docker compose logs cloudflared | grep trycloudflare`).

---

## 0. Credenciales de la demo

| Servicio | URL / acceso | Usuario | Contraseña | Nota |
|---|---|---|---|---|
| Tienda (comprador demo) | `/login` | `demo@tiquart.com` | `demo1234` | 0 boletas; puede comprar 4 por evento |
| Tienda (usuario admin) | `/login` | `admin@tiquart.com` | `admin1234` | rol admin; también puede comprar |
| Panel `/admin` | `/admin` | — | `tiquart-admin` | token `x-admin-token`; se ingresa una vez |
| Preventa interna | — | `preventa@tiquart.com` | aleatoria en cada seed | dueño de las 8 boletas pre-vendidas; no usar |
| Grafana | `http://127.0.0.1:3001` | `admin` | `tiquart` | dashboard `tiquart-main` |
| Prometheus | `http://127.0.0.1:9090` | — | — | sin autenticación |
| Portainer | `http://127.0.0.1:9000` | `admin` | `Tiquart2026!` | configurado y persistente |
| Glances | `http://127.0.0.1:61208` | — | — | sin autenticación |
| WG-Easy | `http://127.0.0.1:51821` | `admin` | `tiquart` | panel WireGuard |
| Samba | `\\127.0.0.1@1445\Compartido` | `tiquart` | `tiquart` | share `Compartido`; en este host el listado funciona, el montaje por 1445 no |
| PostgreSQL | `db:5432` (interno) | `tiquart` | `tiquart` | base `tiquart`; no publicado al host |
| Valkey / Redis | `cache:6379` (interno) | — | — | sin autenticación; no publicado |
| Mosquitto MQTT | `tcp://127.0.0.1:1883` / `ws://127.0.0.1:9001` | — | — | anónimo (`allow_anonymous true`) |
| Tailscale Funnel | URL pública | cuenta Tailscale del estudiante | — | sin credencial en el repositorio |
| Cloudflare | URL de respaldo | — | — | quick tunnel, sin cuenta |

> `make reset` vuelve a crear `demo`, `admin` y `preventa`, y **borra las cuentas que hayan
> creado los compañeros**. Ejecútalo antes de que empiecen a registrarse, no durante la compra.

---

## 1. Checklist previo

### 30 minutos antes

```bash
cd ~/projects/Tiquart
make up
make obs
make rubric
make tunnel
make reset
make smoke
make concurrency
make public-smoke
make public
make url          # anota la URL y ábrela en el celular
```

- [ ] `make ps`: todo `Up` / `healthy`.
- [ ] `make obs-check`: Grafana y Prometheus responden; 4 targets `up`.
- [ ] `make rubric-check`: Portainer, Glances, WG-Easy, Samba y MQTT OK.
- [ ] `make public-smoke`: compra completa a través de la URL pública.
- [ ] `make sse`: el panel en vivo recibe eventos por SSE (Funnel), no solo polling.
- [ ] Abrir en el navegador: tienda, `/live`, `/admin`, Grafana y Portainer.
- [ ] Probar la URL pública desde **datos móviles**, no solo desde el Wi-Fi del computador.
- [ ] Dejar `/admin` con el token `tiquart-admin` ingresado (queda en localStorage).
- [ ] Terminal 1: `make live` (MQTT en vivo).
- [ ] Terminal 2: `make logs` (opcional, para mostrar errores si algo falla).
- [ ] Bajar volumen/notificaciones; cerrar pestañas que consuman RAM.

### 5 minutos antes

```bash
make reset         # deja 360 asientos limpios y usuarios demo
make url
```

- [ ] Escribir la URL pública en el chat/Zoom o proyectarla como QR.
- [ ] Abrir `/live` en el proyector y la tienda en otra pestaña.
- [ ] Verificar que el contador de reserva baje desde 120 s.

### Plan C

| Falla | Respaldo |
|---|---|
| Tailscale Funnel no responde | usar la URL de Cloudflare: `docker compose logs cloudflared \| grep trycloudflare` |
| Cloudflare no responde | `make tunnel` de nuevo y `make url`; la URL cambia |
| Sin internet | demo local en `http://127.0.0.1:8080`; el jurado compra en el mismo equipo |
| Proyector no muestra el celular | usar el modo responsive del navegador (F12) |
| Se agotó el tiempo | saltar la sección 5 (carga) y cerrar con la prueba de concurrencia |

---

## 2. Guion minuto a minuto

### 0:00–1:30 · Gancho y contexto

Frase de entrada:

> “Tiquart vende boletas para conciertos, danza y stand-up. El problema interesante no es la
> página: es que **dos personas no pueden comprar la misma butaca**, aunque hagan clic al mismo
> tiempo. Hoy van a comprar desde sus celulares y vamos a ver los recursos del servidor en vivo.”

Mencionar: 3 eventos, 120 asientos cada uno, reserva de 120 s, pago simulado.

### 1:30–3:00 · Arquitectura en 90 segundos

Mostrar `make ps` y el diagrama del README (sección 2).

> “Todo corre en contenedores dentro de Ubuntu WSL: Traefik recibe, Next.js pinta, FastAPI
> decide, PostgreSQL es la fuente de verdad, Redis limita ráfagas y Mosquitto avisa a los
> monitores. El núcleo de asientos es **CP**: prefiero rechazar una venta antes que vender dos
> veces. El catálogo y las métricas son **AP**: pueden atrasarse sin romper la compra.”

### 3:00–5:00 · Servicios de la rúbrica (rápido, sin quedarse)

1. **Portainer** `http://127.0.0.1:9000` → “administración centralizada de los 15 contenedores”.
2. **Glances** `http://127.0.0.1:61208` → CPU y RAM del host en tiempo real.
3. **Mosquitto** → cambiar a la terminal con `make live`; explicar que cada reserva publica en
   `tiquart/event/{id}`.
4. **WG-Easy** `http://127.0.0.1:51821` → perfiles WireGuard para clientes Windows.
5. **Samba** → aclarar los puertos **1139/1445** porque Windows ocupa 139/445 con red espejada;
   dentro del contenedor SMB sigue en 139/445.

> Si el jurado pregunta por Samba: “no es un capricho, es una decisión de convivencia de puertos
> con el host Windows; el protocolo y la carpeta compartida son los mismos.”

### 5:00–6:00 · Compartir la URL y lanzar la compra

- Proyectar la URL pública y el QR.
- Pedir a 5–10 compañeros: entrar a `/login`, pulsar **“¿No tienes cuenta? Regístrate”** con
  cualquier correo, elegir evento, escoger 1–2 butacas y pagar.
- No compartir la cuenta `demo@tiquart.com` con todos: el límite es **4 boletas por cuenta y por
  evento**. Cada compañero debe tener su propia cuenta.
- Mientras entran, narrar:

> “Cada butaca reservada queda bloqueada 120 segundos. Si alguien más la toca, recibe un 409 y
> la butaca no se libera hasta que expire o se pague.”

- Mostrar en `/live` cómo suben `held` y luego `sold`.

### 6:00–9:00 · La prueba central: sin doble venta

**Opción A — demostración en vivo (recomendada, 10 s).**

Abrir dos ventanas de incógnito, iniciar sesión con dos usuarios distintos, poner el mismo
asiento en ambas y reservar casi al mismo tiempo. Una recibe la reserva; la otra, el error de
asiento ocupado.

> “No es suerte del frontend: el `UPDATE` de PostgreSQL solo toca filas cuyo estado es
> `available`. El segundo comprador actualiza cero filas y la transacción se revierte.”

**Opción B — prueba automatizada (30 s).**

```bash
make concurrency
```

Salida esperada:

```
objetivo: A1 (id=...) con 40 compradores
éxitos: 1 | conflictos: 39 | otros: []
VEREDICTO: OK sin sobreventa
```

> “40 hilos, un solo asiento: exactamente un ganador y 39 conflictos. La base es el árbitro, no
> el navegador.”

Mencionar las otras dos barreras: `tickets.seat_id UNIQUE` y el TTL que libera reservas.

### 9:00–11:00 · Validación de boleta y recursos

1. Ir a `/boletas`, abrir una boleta y mostrar el QR.
2. En `/admin`, pegar el código y validar → **200 válida**.
3. Validar el mismo código otra vez → **409 ya usada**.
4. Cambiar a **Grafana** `http://127.0.0.1:3001` → dashboard `tiquart-main`:
   - asientos vendidos / reservados / disponibles,
   - CPU por contenedor (cAdvisor),
   - CPU y RAM del host (node-exporter).
5. Mostrar el pico real de la prueba de carga: API ≈ 275 % CPU, cAdvisor ≈ 144 %.

> “El cuello de botella es la API y PostgreSQL, no el frontend. Escalaría con réplicas de API
> detrás de Traefik y una base con réplica de lectura; la reserva seguiría siendo atómica.”

### 11:00–13:00 · Prueba de carga (solo si hay tiempo)

```bash
make load
```

Advertir antes:

> “Esta prueba **reinicia** los datos y lanza 60 usuarios virtuales durante 40 segundos. Si
> acaban de comprar, sus boletas de prueba se van a borrar; es data de demostración.”

Resultados que se muestran:

- 737 iteraciones, 1 109 requests, 16 req/s.
- 6.67 % de respuestas `409` **esperadas** por la estampida sobre los mismos asientos.
- `p95` ≈ 2.0 s: se reporta como límite de capacidad del equipo, no como error de consistencia.
- Durante el test, la terminal de MQTT y Grafana muestran el aumento de eventos y CPU.

Si no hay tiempo, saltar y usar la captura/resultados del README (sección 7).

### 13:00–14:30 · Cierre técnico

Tres frases para cerrar:

1. **Consistencia:** “La butaca se vende una sola vez porque la condición y la escritura son la
   misma operación SQL.”
2. **Tolerancia:** “Si la base no responde, prefiero un 503 antes que una sobreventa: el núcleo
   es CP; los bordes (catálogo, métricas, notificaciones) son AP.”
3. **Distribución:** “Traefik, MQTT, Redis, PostgreSQL, túneles y monitores son procesos
   separados en contenedores; el sistema sigue mostrando el estado aunque un monitor se caiga.”

### 14:30–15:00 · Preguntas frecuentes

| Pregunta | Respuesta corta |
|---|---|
| ¿Qué pasa si se cae Redis? | Se pierde el rate limit; la compra sigue porque la verdad está en PostgreSQL |
| ¿Y si se cae Mosquitto? | El mapa se actualiza por polling; la venta no se bloquea |
| ¿Por qué no microservicios? | Monolito modular para 15 min de demo; menos puntos de fallo, misma consistencia |
| ¿Dónde está la partición? | Entre API y PostgreSQL: si no hay quórum de escritura, se rechaza la reserva (CP) |
| ¿Cómo escalan? | Réplicas de API sin estado detrás de Traefik; la reserva atómica se mantiene |
| ¿El pago es real? | No, es simulado; el foco es la consistencia del inventario |
| ¿Por qué Samba en 1139/1445? | Windows ya ocupa 139/445 con `networkingMode=mirrored` |

---

## 3. Después de presentar

```bash
make reset     # dejar datos limpios por si hay otra ronda
make ps
```

No apagar los servicios de la rúbrica hasta que el jurado termine de revisar.
