# ADR 0006 — La tienda es un modelo de lectura (CQRS)

- **Estado:** aceptada
- **Fecha:** 2026-10-07

## Contexto

Sumamos una tienda online (`services/storefront`, puerto 8081) que tiene que mostrar el catálogo con stock en vivo, el seguimiento de cada pedido, el historial de cada cliente y sus notificaciones.

Esos datos ya existen, pero repartidos entre los dueños de cada uno: el stock está en `inventory:*`, el estado del pedido en `orders:*` y los emails solo se loguean en notifications. Si la tienda los leyera directo, o le hiciera HTTP a cada servicio en cada pantalla, rompería el desacople ("una base por servicio") y dependería de que todos estén vivos para mostrar algo.

## Decisión

Aplicamos **CQRS** (*Command Query Responsibility Segregation*): separamos el camino que **cambia** el estado del camino que lo **consulta**.

- **Comandos (escritura):** el navegador llama directo a las APIs dueñas del dato: `POST :3000/orders` para comprar y `POST :3001/admin/stock/:sku/replenish` para reponer. El servidor de la tienda no participa.
- **Consultas (lectura):** el storefront tiene su propio consumer group (`storefront`, creado con ID `0`) y arma, **solo con eventos**, una vista pensada para la pantalla bajo `storefront:*`:

  | Clave | Se arma con | Para qué |
  |---|---|---|
  | `storefront:stock` (hash) | `stock.updated` | stock por producto en el catálogo |
  | `storefront:order:<id>` (JSON) | los 8 eventos del pedido | pasos, estado y motivo legible |
  | `storefront:orders` / `orders-by-email:<email>` (zset) | `order.created` | admin y "Mis pedidos" |
  | `storefront:inbox:<email>` (lista) | `notification.sent` | campana de notificaciones |

- Para que esto fuera posible, los productores publican más hechos: inventory publica `stock.updated` en cada cambio y notifications publica `notification.sent`.
- La API del storefront (`/api/catalog`, `/api/orders/:id`, `/api/orders?email=`, `/api/notifications`) solo lee su vista. Los cambios se empujan al navegador por Socket.IO cuando llega cada evento.
- `demo.reset` borra `storefront:*`; el stock vuelve con los `stock.updated` de la nueva siembra.

## Consecuencias

- ✅ La tienda no conoce a ningún servicio ni lee sus claves: si inventory se cae, el catálogo se sigue viendo con el último stock conocido.
- ✅ La vista tiene la forma exacta que necesita la pantalla (por ejemplo, el motivo de cancelación ya traducido para el cliente).
- ✅ Se puede tirar la vista y reconstruirla desde el stream: el grupo arranca en ID 0.
- ⚠️ **Consistencia eventual:** justo después del `202` la vista todavía no tiene el pedido. La página de seguimiento muestra "lo estamos registrando…" y espera el evento (más un sondeo de respaldo cada 1 s).
- ⚠️ El stock que ve la tienda puede estar un instante atrasado: la verdad la decide inventory al reservar. Si dos clientes compran las últimas unidades a la vez, el segundo termina en `stock.failed` → `payment.refunded` (es la saga de compensación de siempre).
- ⚠️ Los datos quedan duplicados (en `inventory:*` y en `storefront:stock`). Es el precio de CQRS y es intencional.
