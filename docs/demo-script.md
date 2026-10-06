# Guion de la demo (≈ 18 minutos)

> **Pantalla partida:** a la izquierda la **tienda** (http://localhost:8081), a la derecha el **panel técnico** (http://localhost:8080). En Windows: arrastrá cada ventana a un costado (`Win + ←` / `Win + →`).
> Tené una terminal a mano (o abrila cuando haga falta). Los botones del panel también se disparan con las teclas **1–7**.

## Antes de empezar (10 min antes)

1. Abrir Docker Desktop y esperar *Engine running*.
2. `npm run up` → esperar "🧉 MateShop está levantado". `npm run open-store` muestra todas las URLs.
3. Abrir la **tienda**, el **panel** y, en otra pestaña, el **admin** (http://localhost:8081/admin).
4. En el panel: 6 servicios **vivo** (orders, payments, inventory, notifications, storefront, dashboard) y analytics **sin levantar**.
5. Botón **7 · Reiniciar demo** (o `npm run reset`) para arrancar con el stock original: TERMO-04 en 0, YERBA-03 en 2.
6. En la tienda, vaciar el carrito si quedó algo de un ensayo.
7. Abrir una **ventana InPrivate** (`Ctrl + Shift + N`) con la tienda, para la escena de las "últimas yerbas" (tiene su propio carrito).
8. Tener a mano el video de respaldo (ver Plan B).

## Minuto a minuto

| Min | Acción | Qué señalar en pantalla | Qué decir |
|---|---|---|---|
| 0:00 | — | La tienda y el panel lado a lado | "A la izquierda, lo que ve un cliente. A la derecha, lo que pasa por dentro. Son siete servicios y ninguno conoce a los otros: se hablan solo con eventos en Redis." |
| 1:00 | **Tienda:** abrir *Mate de calabaza*, cantidad 2, *Agregar al carrito* | El carrito lateral | "Una tienda normal: catálogo, stock, carrito que no se pierde al recargar." |
| 1:45 | *Ir a pagar* → nombre, email `ana@ejemplo.com`, dirección, tarjeta `4111 1111 1111 1111`, `12/30`, `123` → **Pagar** | El aviso "Pago de prueba" | "La tarjeta es simulada. Y ojo: el total que ve el navegador no vale; el precio lo calcula el servidor con el catálogo." |
| 2:30 | (esperar) | **Tienda:** los 4 pasos se tildan uno por uno. **Panel:** bolitas orders → broker → payments → inventory… | "La API respondió *202 Accepted*: *te escuché*, no *ya está*. Cada tilde de la izquierda es un evento que llegó a la derecha." |
| 3:30 | **Tienda:** campana 🔔 | Los emails: recibido, pago aprobado, productos separados, confirmado | "Notifications escucha los eventos y publica `notification.sent`. La tienda los muestra; nunca le preguntó nada a notifications." |
| 4:00 | **Tienda:** *Ver qué pasó por dentro ↗* | El panel filtrado por ese pedido (banner amarillo) | "Todos los eventos de este pedido comparten el *correlation ID*. Clic en uno para ver el JSON CloudEvents." |
| 5:00 | **Tienda:** volver al catálogo | El stock de *Mate de calabaza* ahora dice 8 | "La tienda es un **modelo de lectura**: arma su propia copia del stock con eventos `stock.updated`. Eso es CQRS." |
| 5:45 | **Tienda:** comprar cualquier cosa con tarjeta `5555 4444 3333 0000` | Seguimiento: *Pago aprobado* en rojo con "Tu pago fue rechazado: fondos insuficientes". **Panel:** `payment.rejected` | "El banco simulado rechaza las tarjetas terminadas en 0000. Orders cancela el pedido sin pasar por inventario." |
| 7:00 | **Tienda (ventana normal):** *Yerba mate 1 kg* × 2 al carrito. **Ventana InPrivate:** también 2 al carrito. Pagar en la normal | La primera compra se confirma; en la InPrivate el carrito avisa "Solo quedan 0" | "Dos clientes quieren las últimas dos yerbas. La tienda mostró stock, pero la verdad la tiene inventory." |
| 8:00 | **InPrivate:** pagar igual | Seguimiento: pago aprobado ✓, *Stock reservado* ✕ y "No había stock suficiente; te devolvimos el dinero". **Panel:** `stock.failed` → `payment.refunded` (amarillo) → `order.cancelled` | "Esto es la **saga con compensación**: el pago ya se había cobrado, así que payments lo devuelve con otro evento. No hay rollback global." |
| 9:30 | **Admin:** *Yerba mate 1 kg*, cantidad 5 → **Reponer stock** | **Admin** y **tienda**: el stock sube solo. **Panel:** `stock.replenished` + `stock.updated` | "Reponer es un comando a inventory; el resto se entera por eventos." |
| 10:30 | Terminal: `npm run kill-notifications` | Panel: notifications **CAÍDO** | "Se cayó el servicio de emails." |
| 11:00 | **Tienda:** comprar algo | El pedido se **confirma igual**, pero la campana no suena. Panel: sube el lag de notifications | "El negocio sigue. Los eventos para notifications esperan en Redis." |
| 12:00 | Terminal: `npm run revive-notifications` | Panel: vuelve a **vivo**, ráfaga de bolitas. **Tienda:** la campana recibe los emails atrasados | "Al volver procesa primero lo pendiente: *at-least-once*, nada se perdió." |
| 13:00 | **Panel:** botón **5 · Reenviar último evento** | Fila "⚠ duplicado ignorado" y contador de duplicados | "Si un evento llega dos veces, cada servicio recuerda su `id` y lo ignora: no se cobra ni se descuenta stock dos veces." |
| 14:00 | **Panel:** botón **6 · Evento envenenado → DLQ** | Fila **INVÁLIDO**, bolita roja a la DLQ | "Un evento que no cumple el contrato va a la *dead letter queue*. El resto ni se entera." |
| 15:00 | Terminal: `npm run add-analytics` | analytics aparece **vivo** y le llegan todos los `order.confirmed` viejos. `npm run logs` → "📊 ventas…" | "Sumé un servicio nuevo sin tocar a nadie; reprocesa toda la historia." |
| 16:00 | (opcional) `npm run scale-payments` + botón **4 · Ráfaga** | payments ×2; la ráfaga aparece en el admin de la tienda | "Dos réplicas del mismo grupo se reparten el trabajo." |
| 17:00 | — | Las dos pantallas | Cierre: "Una tienda que funciona como cualquier otra, pero por dentro: desacople, resiliencia, idempotencia, compensación y CQRS." |
| 17:30 | Preguntas | — | "¿Por qué no Kafka?" → ADR 0002. "¿Y si se cae después de publicar?" → ADR 0004 (outbox). "¿Por qué la tienda tiene su propia copia?" → ADR 0006. |

## Plan B

| Si pasa esto… | Hacer esto |
|---|---|
| La escena de las dos ventanas se complica | **Panel:** botón **3 · Pedido sin stock (TERMO-04)** muestra la misma compensación. Después reponer TERMO-04 desde el admin y comprarlo en la tienda. |
| La tienda o el panel quedaron en un estado raro | Botón **7 · Reiniciar demo** o `npm run reset` (limpia también la vista de la tienda y re-siembra el stock). |
| El carrito tiene cosas de antes | Quitarlas desde el carrito, o abrir la tienda en una ventana InPrivate. |
| El seguimiento se queda en "registrando…" | Mirar en el panel qué servicio está **CAÍDO**: `docker compose start <servicio>`. |
| El panel o la tienda no cargan | Recargar (F5). Si sigue: `docker compose restart dashboard storefront` (se reconstruyen leyendo el stream). |
| Un servicio no levanta | `npm run logs` para ver el error; `docker compose up -d --build <servicio>`. |
| Redis/Docker no responde | `npm run down` y `npm run up` (≈ 30 s). |
| Algo de red/proyector falla | Pasar el **video grabado** del ensayo (grabarlo con `Win + Alt + R`). |
| Se colgó la notebook | Mostrar `docs/architecture.md` (secuencias de la saga y de la compra) y contar la demo sobre los diagramas. |
