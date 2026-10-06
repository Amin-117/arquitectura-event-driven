# ADR 0002 — Redis Streams como broker

- **Estado:** aceptada
- **Fecha:** 2026-10-06

## Contexto

Necesitamos un broker que soporte:

- Log persistente de eventos (para reprocesar historia y reconstruir el panel).
- Varios grupos de consumidores que reciben **todos** los eventos (difusión) y, dentro de cada grupo, reparto de trabajo entre réplicas.
- Confirmación explícita (ACK) y lista de pendientes, para mostrar *at-least-once*, reintentos y recuperación.
- Que levante en segundos con `docker compose up` en la notebook del expositor.

Opciones evaluadas: Kafka, RabbitMQ, NATS JetStream y Redis Streams.

## Decisión

Usamos **Redis 7 Streams** con:

- Un único stream `mateshop.events` donde se publica todo (el panel lo lee entero).
- Un *consumer group* por servicio (`orders`, `payments`, `inventory`, `notifications`, `analytics`, `dashboard`); cada uno filtra por `type`.
- `XACK` después de procesar, `XAUTOCLAIM` para reintentar pendientes "abandonados" y `XPENDING` para contar entregas.
- Un stream aparte `mateshop.dlq` como *dead letter queue*.

### ¿Por qué no Kafka?

Kafka es la opción natural a gran escala (particiones, retención larga, millones de eventos por segundo, ecosistema de conectores). Para esta demo pesa más de lo que aporta:

| | Redis Streams | Kafka |
|---|---|---|
| Arranque en una notebook | 1 contenedor, ~1 s | broker (+ controller KRaft), ~20-40 s, más RAM |
| Conceptos a explicar | stream, grupo, ACK, PEL | topic, partición, offset, rebalanceo, ISR… |
| Reintento por mensaje | `XAUTOCLAIM` nativo | hay que implementarlo (topics de retry) |
| Volumen de la demo | decenas de eventos | pensado para millones |

Además, Redis nos sirve a la vez de "base por servicio" sin sumar otra pieza.

## Consecuencias

- ✅ Todo el sistema arranca rápido y con un solo servicio de infraestructura.
- ✅ Los conceptos (grupos, ACK, pendientes, DLQ) se ven directo en `redis-cli`.
- ⚠️ Un único stream no escala como las particiones de Kafka; si MateShop creciera, habría que particionar por stream o migrar de broker.
- ⚠️ La durabilidad depende de la persistencia de Redis (activamos `appendonly yes`).
