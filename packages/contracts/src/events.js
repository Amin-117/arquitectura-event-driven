import { z } from 'zod'

/**
 * @typedef {Object} OrderItem
 * @property {string} sku  Código de producto, ej. "MATE-01"
 * @property {number} qty  Cantidad (entero > 0)
 */

/**
 * @typedef {Object} OrderCreatedData
 * @property {string} orderId
 * @property {string} customer
 * @property {OrderItem[]} items
 * @property {number} total
 */

/**
 * @typedef {Object} PaymentApprovedData
 * @property {string} orderId
 * @property {string} customer
 * @property {OrderItem[]} items
 * @property {number} total
 * @property {string} paymentId
 */

/**
 * @typedef {Object} PaymentRejectedData
 * @property {string} orderId
 * @property {string} customer
 * @property {number} total
 * @property {string} reason
 */

/**
 * @typedef {Object} StockReservedData
 * @property {string} orderId
 * @property {string} customer
 * @property {OrderItem[]} items
 */

/**
 * @typedef {Object} StockFailedData
 * @property {string} orderId
 * @property {string} customer
 * @property {OrderItem[]} items
 * @property {string[]} missing  SKUs sin stock suficiente
 * @property {string} reason
 */

/**
 * @typedef {Object} PaymentRefundedData
 * @property {string} orderId
 * @property {string} customer
 * @property {number} total
 * @property {string} paymentId
 * @property {string} reason
 */

/**
 * @typedef {Object} OrderConfirmedData
 * @property {string} orderId
 * @property {string} customer
 * @property {OrderItem[]} items
 * @property {number} total
 */

/**
 * @typedef {Object} OrderCancelledData
 * @property {string} orderId
 * @property {string} customer
 * @property {string} reason
 */

/**
 * @typedef {Object} DemoResetData
 * @property {string} requestedBy
 */

/**
 * @typedef {'order.created'|'payment.approved'|'payment.rejected'|'stock.reserved'|'stock.failed'|'payment.refunded'|'order.confirmed'|'order.cancelled'|'demo.reset'} EventType
 */

const orderId = z.string().min(1)
const customer = z.string().min(1)
const item = z.object({ sku: z.string().min(1), qty: z.number().int().positive() })
const items = z.array(item).min(1)
const money = z.number().nonnegative()

/** Cuerpo esperado por POST /orders. */
export const OrderRequestSchema = z.object({
  customer,
  items,
  total: money
})

/** Schema del campo `data` para cada tipo de evento. */
export const DATA_SCHEMAS = {
  'order.created': z.object({ orderId, customer, items, total: money }),
  'payment.approved': z.object({ orderId, customer, items, total: money, paymentId: z.string() }),
  'payment.rejected': z.object({ orderId, customer, total: money, reason: z.string() }),
  'stock.reserved': z.object({ orderId, customer, items }),
  'stock.failed': z.object({ orderId, customer, items, missing: z.array(z.string()), reason: z.string() }),
  'payment.refunded': z.object({ orderId, customer, total: money, paymentId: z.string(), reason: z.string() }),
  'order.confirmed': z.object({ orderId, customer, items, total: money }),
  'order.cancelled': z.object({ orderId, customer, reason: z.string() }),
  'demo.reset': z.object({ requestedBy: z.string() })
}

/** @type {EventType[]} */
export const EVENT_TYPES = /** @type {EventType[]} */ (Object.keys(DATA_SCHEMAS))

/** Quién publica cada tipo (solo informativo: lo usa el panel y la documentación). */
export const PRODUCERS = {
  'order.created': 'orders',
  'payment.approved': 'payments',
  'payment.rejected': 'payments',
  'stock.reserved': 'inventory',
  'stock.failed': 'inventory',
  'payment.refunded': 'payments',
  'order.confirmed': 'orders',
  'order.cancelled': 'orders',
  'demo.reset': 'dashboard'
}

const BUSINESS_TYPES = EVENT_TYPES.filter((t) => t !== 'demo.reset')

/** Tipos que procesa cada servicio (su "filtro" dentro de su consumer group). */
export const SUBSCRIPTIONS = {
  orders: ['payment.rejected', 'stock.reserved', 'payment.refunded', 'demo.reset'],
  payments: ['order.created', 'stock.failed', 'demo.reset'],
  inventory: ['payment.approved', 'demo.reset'],
  notifications: [...BUSINESS_TYPES],
  analytics: ['order.confirmed', 'demo.reset']
}

/** Servicios que procesan un tipo dado. */
export function consumersOf(type) {
  return Object.entries(SUBSCRIPTIONS)
    .filter(([, types]) => types.includes(type))
    .map(([service]) => service)
}
