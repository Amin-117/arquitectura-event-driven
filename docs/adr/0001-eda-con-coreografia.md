# ADR 0001 — Arquitectura orientada a eventos con coreografía

- **Estado:** aceptada
- **Fecha:** 2026-10-06

## Contexto

MateShop es una demo didáctica: un pedido pasa por pagos, inventario, notificaciones y analítica. Queremos mostrar en una exposición cómo varios servicios colaboran **sin conocerse entre sí**, y qué pasa cuando uno se cae, se duplica un mensaje o llega un evento roto.

Hay dos formas típicas de coordinar una saga:

- **Orquestación:** un servicio central le dice a cada uno qué hacer (llamadas o comandos).
- **Coreografía:** cada servicio reacciona a hechos publicados por otros y publica sus propios hechos.

## Decisión

Usamos **coreografía pura** sobre eventos:

- Ningún servicio llama a otro por HTTP ni importa su código. Solo comparten `packages/contracts` (formas de los eventos) y `packages/event-bus` (infraestructura).
- Cada servicio es dueño de su estado en Redis bajo su prefijo (`orders:*`, `payments:*`, `inventory:*`, `analytics:*`), simulando "una base por servicio".
- La única API externa es `POST /orders`, que responde **202 Accepted**: el resultado llega después, por eventos.
- La compensación (devolver el pago si no hay stock) también es un evento (`payment.refunded`), no un rollback.

## Consecuencias

- ✅ Se puede agregar un consumidor nuevo (analytics) en vivo sin tocar a nadie.
- ✅ Si notifications se cae, el resto sigue; al volver procesa lo pendiente.
- ✅ Cada servicio es simple: "cuando pasa X, hago Y y aviso Z".
- ⚠️ El flujo completo no está escrito en un solo lugar: hay que documentarlo (ver `docs/architecture.md`) y verlo en el panel.
- ⚠️ Consistencia eventual: durante unos cientos de milisegundos el pedido está `PENDING`.
- ⚠️ Depurar requiere *correlation ID* en todos los eventos y logs (lo implementamos: `correlationid = order-<id>`).
