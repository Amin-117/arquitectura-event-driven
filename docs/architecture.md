# Arquitectura de MateShop

MateShop es una saga **coreografiada**: cada servicio reacciona a eventos y publica los suyos en un único stream de Redis (`mateshop.events`). Ningún servicio llama a otro por HTTP. Las únicas entradas HTTP son las APIs que usa el navegador: pedidos (:3000), administración de stock (:3001), la tienda (:8081, solo lectura) y el panel (:8080).

Hay dos vistas sobre el mismo sistema:

- **Tienda** (`storefront`, :8081): vista de negocio. Es un **modelo de lectura CQRS** armado solo con eventos (ADR 0006).
- **Panel** (`dashboard`, :8080): vista técnica que muestra cada evento que viaja.

## (a) Contexto (C4 nivel 1)

```mermaid
C4Context
  title MateShop — diagrama de contexto
  Person(cliente, "Cliente", "Compra mates, bombillas, yerba y termos")
  Person(admin, "Administrador", "Repone stock")
  Person(expositor, "Expositor", "Mira el panel y dispara escenas")
  System(mateshop, "MateShop", "Tienda ficticia orientada a eventos sobre Redis Streams")
  System_Ext(email, "Email (simulado)", "notifications loguea y publica notification.sent")

  Rel(cliente, mateshop, "Compra y sigue su pedido", "HTTP + WebSocket")
  Rel(admin, mateshop, "Repone stock", "HTTP")
  Rel(expositor, mateshop, "Mira el flujo de eventos", "HTTP + WebSocket")
  Rel(mateshop, email, "Avisa cada paso del pedido", "log + evento")
```

## (b) Contenedores (C4 nivel 2)

```mermaid
flowchart LR
  cliente([Cliente en el navegador])
  admin([Admin en el navegador])
  expositor([Expositor en el navegador])

  subgraph mateshop [MateShop · docker compose]
    storefront["storefront · tienda<br/>Express + Socket.IO :8081<br/>modelo de lectura storefront:*"]
    orders["orders<br/>API :3000<br/>estado orders:*"]
    payments["payments<br/>estado payments:*<br/>(escalable ×N)"]
    inventory["inventory<br/>admin :3001<br/>estado inventory:*"]
    notifications["notifications<br/>estado notifications:*"]
    analytics["analytics<br/>estado analytics:*<br/>(perfil extra)"]
    dashboard["dashboard · panel<br/>Express + Socket.IO :8080"]

    subgraph redis [Redis 7]
      events[("stream<br/>mateshop.events")]
      dlq[("stream<br/>mateshop.dlq")]
      telemetry{{"pub/sub<br/>mateshop.telemetry"}}
    end
  end

  cliente -- "GET páginas + /api (lectura)" --> storefront
  cliente -- "POST /orders (202)" --> orders
  admin -- "POST /admin/stock/:sku/replenish" --> inventory
  admin -- "GET /admin (lectura)" --> storefront
  expositor -- "HTTP + WebSocket" --> dashboard

  orders & payments & inventory & notifications -- "XADD" --> events
  events -- "XREADGROUP (grupo propio)" --> orders & payments & inventory & notifications & analytics & storefront & dashboard
  payments & notifications -. "evento fallido" .-> dlq
  orders & payments & inventory & notifications & storefront -. "telemetría" .-> telemetry
  telemetry -. "SUBSCRIBE" .-> dashboard
```

**Reglas:**

- Cada servicio tiene su *consumer group* y por eso recibe **todos** los eventos (difusión); procesa solo los tipos que le interesan y hace ACK del resto.
- Dentro de un grupo las réplicas se reparten las entradas (`npm run scale-payments`).
- Cada servicio guarda su estado en Redis bajo su prefijo y nunca lee el de otro.
- `packages/contracts` (catálogo, schemas zod y JSDoc) y `packages/event-bus` (publish/subscribe, idempotencia, reintentos, DLQ, heartbeat) son las únicas piezas compartidas.

## (c) Saga feliz

```mermaid
sequenceDiagram
  autonumber
  actor C as Cliente
  participant O as orders
  participant S as Redis Streams
  participant P as payments
  participant I as inventory
  participant N as notifications

  C->>O: POST /orders {customer, items, total}
  O->>O: guarda pedido PENDING
  O->>S: order.created
  O-->>C: 202 Accepted {orderId}
  S->>P: order.created
  P->>P: demora 300–900 ms · total ≤ 100.000
  P->>S: payment.approved
  S->>I: payment.approved
  I->>I: reserva stock (Lua atómico)
  I->>S: stock.reserved
  S->>O: stock.reserved
  O->>O: PENDING → CONFIRMED
  O->>S: order.confirmed
  Note over N,S: notifications recibe cada evento<br/>y "manda" un email por paso
  S->>N: order.created … order.confirmed
```

## (d) Saga con compensación (sin stock)

```mermaid
sequenceDiagram
  autonumber
  actor C as Cliente
  participant O as orders
  participant S as Redis Streams
  participant P as payments
  participant I as inventory

  C->>O: POST /orders {TERMO-04 ×1}
  O->>S: order.created
  O-->>C: 202 Accepted
  S->>P: order.created
  P->>S: payment.approved
  S->>I: payment.approved
  I->>I: TERMO-04 tiene 0 → no reserva nada
  I->>S: stock.failed {missing: [TERMO-04]}
  S->>P: stock.failed
  rect rgba(251, 191, 36, 0.15)
    Note over P: compensación
    P->>P: APPROVED → REFUNDED
    P->>S: payment.refunded
  end
  S->>O: payment.refunded
  O->>O: PENDING → CANCELLED (sin stock, pago devuelto)
  O->>S: order.cancelled
```

Variante "límite excedido": si `total > 100.000`, payments publica `payment.rejected` y orders cancela el pedido sin pasar por inventory.

## Ciclo de vida de una entrada en un consumer group

```mermaid
stateDiagram-v2
  [*] --> Entregada: XREADGROUP >
  Entregada --> Descartada: tipo que no le interesa → ACK
  Entregada --> DLQ: schema inválido
  Entregada --> Duplicado: event.id ya procesado → ACK
  Entregada --> Procesada: handler OK → ACK
  Entregada --> Pendiente: handler lanzó error (sin ACK)
  Pendiente --> Entregada: XAUTOCLAIM (inactiva > 5 s)
  Pendiente --> DLQ: falló la 3.ª entrega → XADD dlq + ACK
  Procesada --> [*]
  Duplicado --> [*]
  Descartada --> [*]
  DLQ --> [*]
```

## (e) Compra desde la tienda (CQRS)

Comandos por un lado (navegador → orders / inventory), consultas por otro (navegador → modelo de lectura de la tienda).

```mermaid
sequenceDiagram
  autonumber
  actor C as Cliente (navegador)
  participant T as storefront :8081
  participant O as orders :3000
  participant S as Redis Streams
  participant P as payments
  participant I as inventory
  participant N as notifications

  C->>T: GET /api/catalog (lee storefront:stock)
  C->>O: POST /orders {email, cardNumber, items}
  O->>O: total = Σ precio del catálogo × cantidad
  O->>S: order.created {total, email, cardLast4}
  O-->>C: 202 Accepted {orderId}
  C->>T: abre #/pedido/ID (todavía "registrando…")
  S->>T: order.created → storefront:order:ID
  T-->>C: Socket.IO "order" (Pedido recibido ✓)
  S->>P: order.created
  P->>S: payment.approved (o rejected si …0000 o > $100.000)
  S->>I: payment.approved
  I->>S: stock.reserved + stock.updated
  S->>T: stock.updated → storefront:stock
  T-->>C: Socket.IO "stock" (el número baja en vivo)
  S->>O: stock.reserved
  O->>S: order.confirmed
  S->>N: cada evento del pedido
  N->>S: notification.sent {email, asunto, cuerpo}
  S->>T: notification.sent → storefront:inbox:email
  T-->>C: Socket.IO "notification" (🔔 campana)
```

Reposición: el admin hace `POST :3001/admin/stock/:sku/replenish` → inventory publica `stock.replenished` y `stock.updated` → la tienda actualiza su vista y avisa a todos los navegadores.
