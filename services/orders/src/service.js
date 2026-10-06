import { randomUUID } from 'node:crypto'
import { OrderRequestSchema, CATALOG_BY_SKU, priceOf, correlationIdFor, spanishErrors } from '@mateshop/contracts'
import { deleteKeys } from '@mateshop/event-bus'

const orderKey = (orderId) => `orders:${orderId}`
const INDEX_KEY = 'orders:index'

/**
 * @typedef {'PENDING'|'CONFIRMED'|'CANCELLED'} OrderStatus
 * @typedef {Object} Order
 * @property {string} orderId
 * @property {string} customer
 * @property {import('@mateshop/contracts').OrderItem[]} items
 * @property {number} total          calculado con el catálogo, nunca el que manda el cliente
 * @property {string} [email]
 * @property {string} [address]
 * @property {string} [cardLast4]
 * @property {OrderStatus} status
 * @property {string} reason
 * @property {string} createdAt
 * @property {string} [updatedAt]
 */

export class InvalidOrderError extends Error {
  constructor(details) {
    super('pedido inválido')
    this.details = details
  }
}

/**
 * Servicio de pedidos: dueño del estado `orders:*`.
 * @param {{ bus: ReturnType<typeof import('@mateshop/event-bus').createEventBus>, redis: import('ioredis').Redis, logger: import('pino').Logger }} ctx
 */
export function createOrdersService({ bus, redis, logger }) {
  /** Crea el pedido en PENDING y publica order.created. No espera el resultado de la saga. */
  async function placeOrder(input) {
    const parsed = OrderRequestSchema.safeParse(input, { errorMap: spanishErrors })
    if (!parsed.success) {
      throw new InvalidOrderError(parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`))
    }
    const { customer, items, email, address, cardNumber } = parsed.data
    const unknown = items.filter((i) => !CATALOG_BY_SKU[i.sku]).map((i) => i.sku)
    if (unknown.length) throw new InvalidOrderError([`producto desconocido: ${unknown.join(', ')}`])

    // Seguridad: el precio sale del catálogo. El total que manda el navegador se ignora.
    const total = priceOf(items)
    // De la tarjeta solo se conservan los últimos 4 dígitos: el número completo nunca viaja en un evento.
    const cardLast4 = cardNumber ? cardNumber.slice(-4) : undefined
    const orderId = randomUUID().slice(0, 8)
    /** @type {Order} */
    const order = {
      orderId, customer, items, total, email, address, cardLast4,
      status: 'PENDING', reason: '', createdAt: new Date().toISOString()
    }

    const stored = Object.fromEntries(Object.entries(order).filter(([, v]) => v !== undefined))
    await redis
      .multi()
      .hset(orderKey(orderId), { ...stored, items: JSON.stringify(items), total: String(total) })
      .zadd(INDEX_KEY, Date.now(), orderId)
      .exec()
    const data = Object.fromEntries(
      Object.entries({ orderId, customer, items, total, email, cardLast4 }).filter(([, v]) => v !== undefined)
    )
    await bus.publish('order.created', data, { correlationid: correlationIdFor(orderId) })
    logger.info({ correlationid: correlationIdFor(orderId), orderId }, 'pedido creado en PENDING')
    return order
  }

  /** @returns {Promise<Order|null>} */
  async function getOrder(orderId) {
    const raw = await redis.hgetall(orderKey(orderId))
    if (!raw.orderId) return null
    return { ...raw, items: JSON.parse(raw.items), total: Number(raw.total) }
  }

  async function listOrders(limit = 50) {
    const ids = await redis.zrevrange(INDEX_KEY, 0, limit - 1)
    const orders = await Promise.all(ids.map(getOrder))
    return orders.filter(Boolean)
  }

  /** Cambia el estado solo si sigue PENDING: reaplicar el mismo resultado no tiene efecto. */
  async function resolve(orderId, status, reason, log) {
    const order = await getOrder(orderId)
    if (!order) {
      log.warn({ orderId }, 'pedido desconocido (¿se reinició la demo?)')
      return null
    }
    if (order.status !== 'PENDING') {
      log.info({ orderId, status: order.status }, 'el pedido ya estaba resuelto')
      return null
    }
    await redis.hset(orderKey(orderId), { status, reason, updatedAt: new Date().toISOString() })
    log.info({ orderId, status, reason }, `pedido ${status}`)
    return { ...order, status, reason }
  }

  async function cancel(event, reason, log) {
    const order = await resolve(event.data.orderId, 'CANCELLED', reason, log)
    if (!order) return
    await bus.publish(
      'order.cancelled',
      { orderId: order.orderId, customer: order.customer, reason },
      { correlationid: event.correlationid }
    )
  }

  bus.on('payment.rejected', (event, { logger: log }) =>
    cancel(event, `pago rechazado: ${event.data.reason}`, log)
  )

  bus.on('payment.refunded', (event, { logger: log }) =>
    cancel(event, `sin stock, pago devuelto (${event.data.reason})`, log)
  )

  bus.on('stock.reserved', async (event, { logger: log }) => {
    const order = await resolve(event.data.orderId, 'CONFIRMED', '', log)
    if (!order) return
    await bus.publish(
      'order.confirmed',
      { orderId: order.orderId, customer: order.customer, items: order.items, total: order.total },
      { correlationid: event.correlationid }
    )
  })

  bus.on('demo.reset', async (_event, { logger: log }) => {
    const deleted = await deleteKeys(redis, 'orders:*')
    log.info({ deleted }, 'estado de pedidos reiniciado')
  })

  return { placeOrder, getOrder, listOrders }
}
