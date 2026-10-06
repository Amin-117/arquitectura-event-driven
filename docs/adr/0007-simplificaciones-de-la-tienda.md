# ADR 0007 — Simplificaciones de la tienda

- **Estado:** aceptada
- **Fecha:** 2026-10-07

## Contexto

La tienda online se agregó un día antes de la exposición. Mantenemos la regla del ADR 0005: ante la duda, la opción más simple que cumpla el objetivo didáctico, anotada acá.

## Decisiones

| # | Tema | Qué elegimos | Por qué |
|---|---|---|---|
| 1 | Catálogo | Datos fijos en `packages/contracts/src/catalog.js` (10 productos), compartidos por orders, storefront y panel | Es un dato maestro que no cambia durante la demo; no justifica un servicio de catálogo. |
| 2 | Precio | orders calcula `total = Σ precio × cantidad` con el catálogo e **ignora** el `total` del cliente (lo acepta por compatibilidad) | Nunca confiar en el navegador. Hay un test que lo verifica. |
| 3 | Evolución del contrato | `order.created` suma `email` y `cardLast4` como **opcionales**; sigue en `dataversion: "1"` | Es un cambio aditivo: los consumidores viejos lo ignoran y los eventos viejos siguen siendo válidos. |
| 4 | Tarjeta | El navegador manda el número; orders valida 13 a 19 dígitos (sin Luhn) y solo guarda y publica los **últimos 4** | El número completo nunca viaja en un evento. Sin Luhn para que "terminada en 0000" sea fácil de tipear. |
| 5 | Reglas de pago | `…0000` → "fondos insuficientes"; total > $100.000 → "límite excedido"; el resto se aprueba | Dos rechazos distintos para mostrar en vivo. |
| 6 | Email en las notificaciones | notifications guarda `notifications:order:<id>` → email al ver `order.created` y lo usa en los eventos siguientes | Evita agregar `email` a todos los eventos; el servicio es dueño de su dato. Si no hay email (pedidos del panel viejos), solo loguea. |
| 7 | Sin stock en la tienda | No se puede **agregar** un producto sin stock, pero el checkout no bloquea si el stock bajó mientras tanto (se avisa en el carrito) | La verdad la tiene inventory. Así se puede mostrar la compensación desde la tienda: dos pestañas compran las últimas unidades. |
| 8 | Identidad del cliente | Email guardado en `localStorage`; "Mis pedidos" y la campana filtran por ese email | Sin login, como pide la consigna. |
| 9 | Tiempo real | Socket.IO emite **a todos** los navegadores y cada página filtra lo suyo (por email o por pedido) | Más simple que salas por usuario. No es privado: aceptable para una demo sin datos reales. |
| 10 | Admin | `/admin` sin login; repone stock llamando desde el navegador a `POST :3001/admin/stock/:sku/replenish` | Igual que el panel con orders: el servidor de la tienda no llama a nadie. |
| 11 | URLs de otros servicios | El navegador las arma con su propio host (`:3000`, `:3001`, `:8080`) | Funciona igual desde `localhost` o desde un celular en la misma red. |
| 12 | Imágenes | 10 ilustraciones SVG propias en `services/storefront/public/img/` | Sin imágenes externas ni marcas reales; pesan poco y escalan bien en el proyector. |
| 13 | Tipografía | Fuentes del sistema (serif para títulos) | La demo tiene que verse bien sin internet. |
| 14 | Escenas del panel | Usan productos del catálogo nuevo con email `<nombre>@ejemplo.com` y no mandan total | Sus pedidos aparecen también en la tienda y en el admin. |
| 15 | Tests existentes | El test "pedido que excede el límite" pasó de 1×MATE-01 con `total: 150000` a 7×MATE-01 + 2×BOMBILLA-02 ($121.000); los tests de saga filtran los 8 tipos del pedido (ahora también viaja `notification.sent` con el mismo correlation ID) | Consecuencia directa del precio calculado en el servidor y de los eventos nuevos. Lo que se verifica no cambió. |

## Consecuencias

La tienda funciona de punta a punta con el mismo bus de eventos. Lo que una tienda real agregaría (login, pagos reales, catálogo editable, reserva temporal de stock en el carrito) queda fuera de alcance y sirve como tema de preguntas.
