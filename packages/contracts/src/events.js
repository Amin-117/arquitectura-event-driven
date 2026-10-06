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
 * @typedef {Object} StockUpdatedData
 * @property {string} sku
 * @property {number} available   stock disponible después del cambio
 */

/**
 * @typedef {Object} StockReplenishedData
 * @property {string} sku
 * @property {number} qty          unidades agregadas
 * @property {number} available
 */

/**
 * @typedef {Object} NotificationSentData
 * @property {string} email
 * @property {string} asunto
 * @property {string} cuerpo
 * @property {string} orderId
 */

/**
 * @typedef {'order.created'|'payment.approved'|'payment.rejected'|'stock.reserved'|'stock.failed'|'payment.refunded'|'order.confirmed'|'order.cancelled'|'stock.updated'|'stock.replenished'|'notification.sent'|'demo.reset'} EventType
 */

const orderId = z.string().min(1)
const customer = z.string().min(1)
const sku = z.string().min(1)
const item = z.object({ sku, qty: z.number().int().positive() })
const items = z.array(item).min(1)
const money = z.number().nonnegative()
const email = z.string().email()

/**
 * Cuerpo esperado por POST /orders.
 * `total` se acepta por compatibilidad pero se IGNORA: el precio lo calcula orders con el catálogo.
 */
export const OrderRequestSchema = z.object({
  customer,
  email: email.optional(),
  address: z.string().max(200).optional(),
  cardNumber: z
    .string()
    .transform((s) => s.replace(/[\s-]/g, ''))
    .pipe(z.string().regex(/^\d{13,19}$/, 'debe tener entre 13 y 19 dígitos'))
    .optional(),
  items,
  total: z.unknown().optional()
})

/** Schema del campo `data` para cada tipo de evento. */
export const DATA_SCHEMAS = {
  // email y cardLast4 se sumaron después como opcionales: cambio compatible, sigue siendo dataversion 1.
  'order.created': z.object({
    orderId,
    customer,
    items,
    total: money,
    email: email.optional(),
    cardLast4: z.string().regex(/^\d{4}$/).optional()
  }),
  'payment.approved': z.object({ orderId, customer, items, total: money, paymentId: z.string() }),
  'payment.rejected': z.object({ orderId, customer, total: money, reason: z.string() }),
  'stock.reserved': z.object({ orderId, customer, items }),
  'stock.failed': z.object({ orderId, customer, items, missing: z.array(z.string()), reason: z.string() }),
  'payment.refunded': z.object({ orderId, customer, total: money, paymentId: z.string(), reason: z.string() }),
  'order.confirmed': z.object({ orderId, customer, items, total: money }),
  'order.cancelled': z.object({ orderId, customer, reason: z.string() }),
  'stock.updated': z.object({ sku, available: z.number().int().nonnegative() }),
  'stock.replenished': z.object({ sku, qty: z.number().int().positive(), available: z.number().int().nonnegative() }),
  'notification.sent': z.object({ email, asunto: z.string().min(1), cuerpo: z.string().min(1), orderId }),
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
  'stock.updated': 'inventory',
  'stock.replenished': 'inventory',
  'notification.sent': 'notifications',
  'demo.reset': 'dashboard'
}

/** Los 8 eventos del ciclo de vida de un pedido (la saga). */
export const ORDER_FLOW_TYPES = [
  'order.created',
  'payment.approved',
  'payment.rejected',
  'stock.reserved',
  'stock.failed',
  'payment.refunded',
  'order.confirmed',
  'order.cancelled'
]

/** Tipos que procesa cada servicio (su "filtro" dentro de su consumer group). */
export const SUBSCRIPTIONS = {
  orders: ['payment.rejected', 'stock.reserved', 'payment.refunded', 'demo.reset'],
  payments: ['order.created', 'stock.failed', 'demo.reset'],
  inventory: ['payment.approved', 'demo.reset'],
  notifications: [...ORDER_FLOW_TYPES, 'demo.reset'],
  analytics: ['order.confirmed', 'demo.reset'],
  // La tienda es un modelo de lectura: arma su propia vista con los eventos (ver ADR 0006).
  storefront: [...ORDER_FLOW_TYPES, 'stock.updated', 'notification.sent', 'demo.reset']
}

/** Servicios que procesan un tipo dado. */
export function consumersOf(type) {
  return Object.entries(SUBSCRIPTIONS)
    .filter(([, types]) => types.includes(type))
    .map(([service]) => service)
}
