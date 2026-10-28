SHELL := /bin/bash
COMPOSE := docker compose

.PHONY: up down reset seed logs ps smoke concurrency obs rubric load tunnel public public-smoke sse obs-check rubric-check live url dev

up:
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

reset:
	bash scripts/reset.sh

seed:
	$(COMPOSE) exec -T api python -m app.seed

logs:
	$(COMPOSE) logs -f --tail=100 api

ps:
	$(COMPOSE) ps

smoke:
	$(COMPOSE) cp backend/tests/smoke.py api:/tmp/smoke.py
	$(COMPOSE) exec -T api python /tmp/smoke.py

concurrency:
	$(COMPOSE) cp backend/tests/concurrency.py api:/tmp/concurrency.py
	$(COMPOSE) exec -T api python /tmp/concurrency.py 40

obs:
	$(COMPOSE) --profile obs up -d

rubric:
	$(COMPOSE) --profile rubric up -d

load:
	bash scripts/load-test.sh

# Túnel público: Cloudflare quick tunnel (estable). Tailscale Funnel tiene prioridad si está activo.
tunnel:
	$(COMPOSE) --profile tunnel up -d --force-recreate cloudflared
	@sleep 12
	@bash scripts/url.sh

public:
	@bash scripts/public-check.sh

public-smoke:
	python3 scripts/public-smoke.py

sse:
	bash scripts/sse-check.sh

obs-check:
	bash scripts/obs-check.sh

rubric-check:
	bash scripts/rubric-check.sh

# Consola MQTT para proyectar durante la compra masiva.
live:
	mosquitto_sub -h 127.0.0.1 -t 'tiquart/#' -v

url:
	@bash scripts/url.sh

dev:
	cd frontend && npm run dev
