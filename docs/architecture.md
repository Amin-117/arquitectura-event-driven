# Arquitectura de MateShop

MateShop es una saga **coreografiada**: cada servicio reacciona a eventos y publica los suyos en un único stream de Redis (`mateshop.events`). Nadie llama a nadie por HTTP; la única entrada HTTP es la API de pedidos.

## (a) Contexto (C4 nivel 1)

```mermaid
C4Context
  title MateShop — diagrama de contexto
  Person(cliente, "Cliente", "Compra mates, bombillas, yerba y termos")
  Person(expositor, "Expositor", "Dispara escenas y explica lo que pasa")
  System(mateshop, "MateShop", "Tienda ficticia orientada a eventos sobre Redis Streams")
  System_Ext(email, "Email (simulado)", "notifications solo loguea los mensajes")

  Rel(cliente, mateshop, "Crea pedidos", "HTTP POST /orders")
  Rel(expositor, mateshop, "Mira el panel y dispara escenas", "HTTP + WebSocket")
  Rel(mateshop, email, "Avisa cada paso del pedido", "log")
```

## (b) Contenedores (C4 nivel 2)

```mermaid
flowchart LR
  cliente([Cliente / curl / npm run order])
  navegador([Navegador del expositor])

  subgraph mateshop [MateShop · docker compose]
    orders["orders<br/>Express :3000<br/>estado orders:*"]
    payments["payments<br/>estado payments:*<br/>(escalable ×N)"]
    inventory["inventory<br/>estado inventory:*"]
    notifications["notifications<br/>emails en logs"]
    analytics["analytics<br/>estado analytics:*<br/>(perfil extra)"]
    dashboard["dashboard<br/>Express + Socket.IO :8080"]

    subgraph redis [Redis 7]
      events[("stream<br/>mateshop.events")]
      dlq[("stream<br/>mateshop.dlq")]
      telemetry{{"pub/sub<br/>mateshop.telemetry"}}
      keys[("claves por servicio<br/>+ heartbeat:*")]
    end
  end

  cliente -- "POST /orders (202)" --> orders
  navegador -- "HTTP + WebSocket" --> dashboard
  navegador -- "POST /orders (escenas)" --> orders

  orders & payments & inventory -- "XADD" --> events
  events -- "XREADGROUP (grupo propio)" --> orders & payments & inventory & notifications & analytics & dashboard
  payments & notifications -. "evento fallido" .-> dlq
  orders & payments & inventory & notifications & analytics -. "telemetría" .-> telemetry
  telemetry -. "SUBSCRIBE" .-> dashboard
  orders & payments & inventory & analytics --- keys
```

**Reglas:**

- Cada servicio tiene su *consumer group* y por eso recibe **todos** los eventos (difusión); procesa solo los tipos que le interesan y hace ACK del resto.
- Dentro de un grupo las réplicas se reparten las entradas (`npm run scale-payments`).
- `packages/contracts` (schemas zod + JSDoc) y `packages/event-bus` (publish/subscribe, idempotencia, reintentos, DLQ, heartbeat) son las únicas piezas compartidas.

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
