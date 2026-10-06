# ADR 0005 — Simplificaciones de la demo

- **Estado:** aceptada
- **Fecha:** 2026-10-06

## Contexto

El pedido original deja algunos puntos abiertos. La regla acordada fue: **ante la duda, la opción más simple que cumpla el objetivo didáctico**, y anotarla acá.

## Decisiones

| # | Tema | Qué elegimos | Por qué |
|---|---|---|---|
| 1 | Telemetría del bus (procesado, reintento, duplicado, DLQ) | Redis **Pub/Sub** en el canal `mateshop.telemetry`, no persistida | No ensucia el stream de negocio ni la ven los demás grupos. Si el panel no está conectado, se pierde (no importa). |
| 2 | Escena "Evento envenenado" | El panel publica un `order.created` que **no cumple el schema** | Va a la DLQ al instante en payments, notifications y storefront (los grupos que procesan ese tipo). El camino "3 intentos fallidos → DLQ" está cubierto por `tests/dlq.test.js`. |
| 3 | Escena "Reenviar último evento" | Reenvía el **último evento de negocio válido** (ignora `demo.reset`, los inválidos y los del panel) con el mismo `id` | Así siempre muestra "duplicado ignorado" en algún servicio. |
| 4 | Escenas de pedidos desde el panel | Las hace **el navegador** contra `POST :3000/orders` (con CORS) | El servidor del panel nunca llama por HTTP a otro servicio. |
| 5 | Escenas duplicado / veneno / reinicio | Las ejecuta el **servidor del panel** directamente sobre Redis | Son herramientas de demo, no parte del negocio. |
| 6 | Reinicio | `XTRIM MAXLEN 0` en ambos streams (los grupos sobreviven) + evento `demo.reset`; cada servicio borra **sus** claves e inventory vuelve a sembrar | Coreográfico también: el panel no toca claves ajenas. Las claves `processed:*` se dejan expirar solas. |
| 7 | Panel al reiniciarse | Reconstruye línea de tiempo y pedidos con `XRANGE mateshop.events - +`; su grupo se crea con `$` y se descartan entradas ya vistas por `streamId` | No queda vacío en medio de la demo y no muestra nada dos veces. |
| 8 | Estado del panel | Derivado **solo de eventos** + métricas de infraestructura (`XLEN`, `XINFO GROUPS`, heartbeats) | Respeta "una base por servicio": no lee `orders:*` ni `analytics:*`. |
| 9 | analytics | Sus totales se ven en sus logs (`npm run logs`), no en el panel | El panel no lee estado ajeno y analytics no tiene eventos de salida en el catálogo. |
| 10 | Tests | Contra el Redis de compose (`localhost:6379`, **base 15**), servicios levantados dentro del proceso de test | Más simple que testcontainers; no pisa los datos de la demo (base 0). |
| 11 | Windows sin `make` | `Makefile` + scripts `npm run <mismo nombre>`; los pedidos se crean con scripts Node (sin `curl`) | La demo anda sin instalar nada extra. |
| 12 | Imagen Docker | Una sola imagen para todo el monorepo; cada servicio cambia el comando | Un build, caché compartida. |
| 13 | Nombre del consumidor | `<servicio>-<hostname>` | Estable entre `stop`/`start` del mismo contenedor, así recupera sus pendientes. Los consumidores de contenedores viejos quedan listados en el grupo sin efecto (sus pendientes los reclama `XAUTOCLAIM`). |
| 14 | Datos de negocio fuera de contracts | El límite de pago vive en payments y el stock inicial en inventory | Los contratos describen eventos, no reglas de negocio. |
| 15 | Publicación sin *outbox* | Se guarda el estado y después se publica | Ventana mínima de inconsistencia aceptable para la demo (ver ADR 0004). |
| 16 | Montos | Enteros en pesos, `total` lo informa el cliente | No hay catálogo de precios en orders; el panel calcula los totales con su tabla de precios. |

## Consecuencias

La demo es más corta de explicar y arranca sin pasos manuales. Cada simplificación tiene su versión "de producción" (outbox, telemetría persistida, catálogo de precios, testcontainers), que se puede mencionar en la exposición como siguiente paso.
