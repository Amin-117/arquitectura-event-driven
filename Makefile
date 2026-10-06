# Atajos para la exposición. Cada target tiene su equivalente: npm run <target>
# (en Windows sin make, usá directamente npm run ...)

.PHONY: help open-store up down order order-rejected order-nostock burst duplicate poison reset kill-notifications revive-notifications add-analytics scale-payments logs test

help: ## Muestra esta ayuda
	@node scripts/help.js

open-store: ## Muestra las URLs de la tienda, el admin y el panel
	@node scripts/open-store.js

up: ## Levanta todo (redis + servicios + panel)
	docker compose up --build -d
	@node scripts/info.js

down: ## Baja todo y borra volúmenes
	docker compose --profile extra down -v --remove-orphans

order: ## Escena 1: pedido normal
	node scripts/order.js normal

order-rejected: ## Escena 2: pedido que excede el límite
	node scripts/order.js rechazado

order-nostock: ## Escena 3: pedido sin stock (TERMO-04)
	node scripts/order.js sin-stock

burst: ## Escena 4: ráfaga de 10 pedidos
	node scripts/scene.js burst

duplicate: ## Escena 5: reenviar el último evento (duplicado)
	node scripts/scene.js duplicate

poison: ## Escena 6: evento envenenado → DLQ
	node scripts/scene.js poison

reset: ## Escena 7: reinicia el estado de la demo
	node scripts/scene.js reset

kill-notifications: ## Apaga notifications (escena de resiliencia)
	docker compose stop notifications

revive-notifications: ## Vuelve a prender notifications
	docker compose start notifications

add-analytics: ## Levanta analytics en vivo (reprocesa la historia)
	docker compose --profile extra up -d analytics

scale-payments: ## Escala payments a 2 réplicas
	docker compose up -d --scale payments=2 --no-recreate

logs: ## Logs combinados con colores
	docker compose --profile extra logs -f --tail=30

test: ## Corre los tests (necesita Redis: make up o docker compose up -d redis)
	npm test
