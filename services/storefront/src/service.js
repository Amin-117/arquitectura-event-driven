import { CATALOG, CATALOG_BY_SKU, CATEGORIES } from '@mateshop/contracts'
import { deleteKeys } from '@mateshop/event-bus'

const KEYS = {
  stock: 'storefront:stock',
  order: (orderId) => `storefront:order:${orderId}`,
  orders: 'storefront:orders',
  byEmail: (email) => `storefront:orders-by-email:${email.toLowerCase()}`,
  inbox: (email) => `storefront:inbox:${email.toLowerCase()}`
}

const INBOX_SIZE = 50

/**
 * @typedef {'received'|'paid'|'reserved'|'confirmed'} StepKey
 * @typedef {Object} StoreOrder
 * @property {string} orderId
 * @property {string} customer
 * @property {string} [email]
 * @property {{ sku: string, qty: number, name?: string, price?: number }[]} items
 * @property {number} total
 * @property {'PENDING'|'CONFIRMED'|'CANCELLED'} status
 * @property {string} reason                motivo en lenguaje claro para el cliente
 * @property {Partial<Record<StepKey, string>>} steps   hora en que se cumplió cada paso
 * @property {StepKey|null} failedStep
 * @property {boolean} refunded
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/** Traduce el motivo técnico del rechazo a algo que entienda el cliente. */
function paymentRejectedMessage(reason) {
  if (reason === 'fondos insuficientes') return 'Tu pago fue rechazado: fondos insuficientes'
  if (reason === 'límite excedido') return 'Tu pago fue rechazado: el total supera el límite de $100.000'
  return `Tu pago fue rechazado: ${reason}`
}

/**
 * Modelo de lectura de la tienda (CQRS): se arma SOLO con eventos y vive bajo `storefront:*`.
 * Nunca lee claves de otros servicios ni les hace llamadas.
 * @param {{
 *   bus: ReturnType<typeof import('@mateshop/event-bus').createEventBus>,
 *   redis: import('ioredis').Redis,
 *   onChange?: (kind: 'stock'|'order'|'notification'|'reset', payload: any) => void
 * }} ctx
 */
export function createStorefrontReadModel({ bus, redis, onChange = () => {} }) {
  /** @returns {Promise<StoreOrder|null>} */
  async function getOrder(orderId) {
    const raw = await redis.get(KEYS.order(orderId))
    return raw ? enrich(JSON.parse(raw)) : null
  }

  function enrich(order) {
    return {
      ...order,
      items: order.items.map((i) => ({ ...i, name: CATALOG_BY_SKU[i.sku]?.name ?? i.sku, price: CATALOG_BY_SKU[i.sku]?.price }))
    }
  }

  /** Aplica un cambio a la vista de un pedido y avisa a los navegadores conectados. */
  async function updateOrder(event, change) {
    const { orderId, customer } = event.data
    const current = await redis.get(KEYS.order(orderId))
    /** @type {StoreOrder} */
    const order = current
      ? JSON.parse(current)
      : {
          orderId, customer, items: [], total: 0, status: 'PENDING', reason: '',
          steps: {}, failedStep: null, refunded: false, createdAt: event.time, updatedAt: event.time
        }
    change(order)
    order.updatedAt = event.time
    await redis.set(KEYS.order(orderId), JSON.stringify(order))
    await redis.zadd(KEYS.orders, Date.parse(order.createdAt) || Date.now(), orderId)
    if (order.email) await redis.zadd(KEYS.byEmail(order.email), Date.parse(order.createdAt) || Date.now(), orderId)
    onChange('order', enrich(order))
  }

  bus.on('order.created', (event) =>
    updateOrder(event, (o) => {
      Object.assign(o, {
        customer: event.data.customer,
        email: event.data.email,
        items: event.data.items,
        total: event.data.total,
        createdAt: event.time
      })
      o.steps.received = event.time
    })
  )

  bus.on('payment.approved', (event) => updateOrder(event, (o) => void (o.steps.paid = event.time)))

  bus.on('payment.rejected', (event) =>
    updateOrder(event, (o) => {
      o.failedStep = 'paid'
      o.reason = paymentRejectedMessage(event.data.reason)
    })
  )

  bus.on('stock.reserved', (event) => updateOrder(event, (o) => void (o.steps.reserved = event.time)))

  bus.on('stock.failed', (event) =>
    updateOrder(event, (o) => {
      o.failedStep = 'reserved'
      o.reason = 'No había stock suficiente; estamos devolviendo tu dinero'
    })
  )

  bus.on('payment.refunded', (event) =>
    updateOrder(event, (o) => {
      o.refunded = true
      o.reason = 'No había stock suficiente; te devolvimos el dinero'
    })
  )

  bus.on('order.confirmed', (event) =>
    updateOrder(event, (o) => {
      o.status = 'CONFIRMED'
      o.steps.confirmed = event.time
    })
  )

  bus.on('order.cancelled', (event) =>
    updateOrder(event, (o) => {
      o.status = 'CANCELLED'
      o.reason ||= event.data.reason
    })
  )

  bus.on('stock.updated', async (event) => {
    const { sku, available } = event.data
    await redis.hset(KEYS.stock, sku, available)
    onChange('stock', { sku, available })
  })

  bus.on('notification.sent', async (event) => {
    const notification = { id: event.id, time: event.time, ...event.data }
    await redis.multi().lpush(KEYS.inbox(event.data.email), JSON.stringify(notification)).ltrim(KEYS.inbox(event.data.email), 0, INBOX_SIZE - 1).exec()
    onChange('notification', notification)
  })

  bus.on('demo.reset', async () => {
    await deleteKeys(redis, 'storefront:*')
    onChange('reset', {})
  })

  // ---------- consultas (las usa la API de lectura) ----------

  async function catalog() {
    const stock = await redis.hgetall(KEYS.stock)
    return CATALOG.map((p) => ({
      ...p,
      categoryLabel: CATEGORIES[p.category],
      image: `/img/${p.sku}.svg`,
      available: stock[p.sku] === undefined ? null : Number(stock[p.sku])
    }))
  }

  async function ordersFrom(key, limit) {
    const ids = await redis.zrevrange(key, 0, limit - 1)
    return (await Promise.all(ids.map(getOrder))).filter(Boolean)
  }

  const ordersByEmail = (email, limit = 50) => ordersFrom(KEYS.byEmail(email), limit)
  const allOrders = (limit = 100) => ordersFrom(KEYS.orders, limit)

  async function inbox(email) {
    return (await redis.lrange(KEYS.inbox(email), 0, INBOX_SIZE - 1)).map((n) => JSON.parse(n))
  }

  return { catalog, getOrder, ordersByEmail, allOrders, inbox }
}
