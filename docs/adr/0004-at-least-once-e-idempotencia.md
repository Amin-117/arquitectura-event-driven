# ADR 0004 — Entrega *at-least-once* + consumidores idempotentes

- **Estado:** aceptada
- **Fecha:** 2026-10-06

## Contexto

En un sistema distribuido un mensaje puede perderse o duplicarse (caídas, reintentos, reenvíos). *Exactly-once* de punta a punta es caro y frágil. Queremos **no perder pedidos** y que un duplicado **no cobre dos veces ni descuente stock dos veces**.

## Decisión

Implementado en `packages/event-bus/src/bus.js`:

1. **ACK después de procesar.** Si el proceso muere a mitad de camino, la entrada queda en la lista de pendientes (PEL) del grupo y se vuelve a entregar.
2. **Idempotencia por `event.id`.** Antes de procesar: `SET processed:<grupo>:<eventId> <streamId> NX EX 86400`.
   - Si la clave ya existía **con otro streamId**, es un duplicado real (el mismo evento publicado dos veces): se loguea `duplicado ignorado`, se hace ACK, se incrementa `metrics:duplicates` y se avisa al panel.
   - Si existía **con el mismo streamId**, es la misma entrada re-entregada (reintento o recuperación tras caída): se vuelve a procesar. Guardar el streamId evita que un reintento legítimo se confunda con un duplicado.
3. **Reintentos.** Si el handler lanza error no hay ACK. Un loop periódico (cada 2 s) usa `XAUTOCLAIM` para tomar pendientes con más de 5 s de inactividad y los reintenta. El número de entrega sale de `XPENDING`.
4. **DLQ.** Si falla la entrega número 3, el evento se copia a `mateshop.dlq` (con error, grupo, servicio e intentos), se hace ACK y se borra su clave de idempotencia. Un evento que no cumple el schema va a la DLQ en la primera entrega.
5. **Recuperación tras caída.** Al arrancar, cada consumidor lee primero sus propios pendientes (`XREADGROUP … 0`) y recién después los nuevos (`>`).
6. **Apagado limpio.** Con `SIGTERM` se deja de leer, se termina el evento en curso y se cierra la conexión; lo no procesado queda pendiente.

Además, los handlers de negocio son idempotentes "por diseño" donde es barato: orders solo cambia un pedido que sigue `PENDING`, payments solo devuelve un pago `APPROVED`, inventory reserva todos los ítems en un script Lua atómico.

## Consecuencias

- ✅ Ningún evento se pierde por una caída: o se procesa o termina en la DLQ.
- ✅ Los duplicados no generan efectos dobles y se ven en el panel.
- ⚠️ Si un servicio muere *después* de publicar su evento de salida pero *antes* del ACK, al reintentar puede publicar otro evento con un `id` nuevo (no es un duplicado detectable). Lo mitigan las guardas de estado de cada servicio; la solución completa sería un *outbox* (fuera del alcance de la demo).
- ⚠️ La clave de idempotencia vive 24 h: un reenvío más tardío se procesaría de nuevo.
