# Guion de la demo (≈ 15 minutos)

> Proyectar **http://localhost:8080** en pantalla completa (F11). Tener una terminal visible al costado o en otra ventana.
> Los botones del panel también se pueden disparar con las teclas **1–7**.

## Antes de empezar (10 min antes)

1. Abrir Docker Desktop y esperar a que diga *Engine running*.
2. `npm run up` → esperar el mensaje "🧉 MateShop está levantado".
3. Abrir el panel y verificar: 5 servicios **vivo**, analytics **sin levantar**, contadores en 0.
4. Si hay restos de un ensayo: botón **7 · Reiniciar demo** (o `npm run reset`).
5. Dejar copiados en la terminal los comandos de la tarjeta "Escenas por terminal".
6. Tener a mano el video de respaldo (ver Plan B).

## Minuto a minuto

| Min | Acción | Qué señalar en pantalla | Qué decir |
|---|---|---|---|
| 0:00 | — | El diagrama: servicios alrededor de Redis | "Esto es MateShop, una tienda de mates. Tiene cinco servicios y ninguno conoce a los otros: solo publican y escuchan eventos en un stream de Redis." |
| 1:00 | Botón **1 · Pedido normal** | La bolita azul de orders al broker; el aviso "202 Accepted" | "La API respondió 202: *te escuché*, no *ya está*. El pedido arranca en PENDIENTE." |
| 1:30 | (esperar) | Bolitas a payments, inventory, notifications; tabla de pedidos pasa a **CONFIRMADO** | "Payments escuchó `order.created`, aprobó, inventory reservó, orders confirmó. Nadie llamó a nadie." |
| 2:30 | Clic en un evento de la línea de tiempo | El JSON CloudEvents | "Todos los eventos tienen el mismo sobre estándar: id, tipo, quién lo publicó y el `correlationid` que une todo el pedido." |
| 3:30 | Botón **2 · Pedido que excede el límite** | `payment.rejected` en rojo, pedido **CANCELADO** | "Regla de negocio en payments: más de $100.000 no se aprueba. Orders reacciona al rechazo." |
| 4:30 | Botón **3 · Pedido sin stock (TERMO-04)** | `payment.approved` → `stock.failed` → `payment.refunded` (amarillo) → `order.cancelled` | "Acá está la **saga**: no hay transacción global. Payments ya cobró, así que **compensa**: devuelve la plata publicando `payment.refunded`." |
| 6:00 | Terminal: `npm run kill-notifications` | notifications pasa a **CAÍDO** (dashed) | "Se cayó el servicio de emails." |
| 6:30 | Botón **1** dos veces | Los pedidos se **confirman igual**; no llegan bolitas a notifications; el lag de su grupo sube | "El negocio sigue. Los eventos para notifications esperan en Redis." |
| 7:30 | Terminal: `npm run revive-notifications` | notifications vuelve a **vivo** y le llega una ráfaga de bolitas; el lag baja a 0 | "Al volver procesa primero lo pendiente. Nada se perdió: es *at-least-once*." |
| 8:30 | Botón **5 · Reenviar último evento (duplicado)** | Fila "⚠ duplicado ignorado por …" y el contador **duplicados ignorados** sube | "*At-least-once* significa que puede llegar dos veces. Cada servicio recuerda los `id` que ya procesó y lo ignora: no cobramos ni descontamos stock dos veces." |
| 9:30 | Botón **6 · Evento envenenado → DLQ** | Fila roja **INVÁLIDO**, bolita roja a la DLQ, contador **DLQ** sube | "Un evento que no cumple el contrato no se reintenta: va a la *dead letter queue* para que lo mire una persona. El resto del sistema ni se entera." |
| 10:30 | Terminal: `npm run add-analytics` | analytics aparece **vivo** y recibe bolitas de todos los `order.confirmed` viejos | "Sumé un servicio nuevo sin tocar a nadie. Como su grupo arranca en ID 0, reprocesa toda la historia." Mostrar `npm run logs` → línea "📊 ventas: …". |
| 12:00 | Terminal: `npm run scale-payments`, después botón **4 · Ráfaga de 10 pedidos** | payments con badge **×2**; la ráfaga se reparte; algunos pedidos cancelados por falta de stock de YERBA-03 | "Dos réplicas en el mismo consumer group se reparten el trabajo. Y como el stock es real, algunos pedidos de la ráfaga se cancelan solos." |
| 13:30 | — | Contadores del encabezado | Cierre: "Desacople, resiliencia, idempotencia, compensación. Todo con un stream y contratos claros." |
| 14:00 | Preguntas | — | Si preguntan "¿por qué no Kafka?" → ADR 0002. "¿Y si se cae después de publicar?" → ADR 0004 (outbox). |

## Plan B

| Si pasa esto… | Hacer esto |
|---|---|
| El panel quedó en un estado raro | Botón **7 · Reiniciar demo** o `npm run reset`. |
| El panel no carga | Recargar (F5). Si sigue: `docker compose restart dashboard` (reconstruye todo leyendo el stream). |
| Un servicio no levanta | `npm run logs` para ver el error; `docker compose up -d --build <servicio>`. |
| Redis/Docker no responde | `npm run down` y `npm run up` (≈ 30 s). |
| Algo de red/proyector falla | Pasar el **video grabado** del ensayo (grabarlo con la barra de juegos de Windows: `Win + Alt + R`). |
| Se colgó la notebook | Mostrar `docs/architecture.md` (diagramas de secuencia) y contar la demo sobre los diagramas. |
