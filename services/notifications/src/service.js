import { SUBSCRIPTIONS } from '@mateshop/contracts'

const pesos = (n) => `$${Number(n).toLocaleString('es-AR')}`

/** Texto del "email" para cada tipo de evento. */
const TEMPLATES = {
  'order.created': (d) => `recibimos tu pedido #${d.orderId} por ${pesos(d.total)}`,
  'payment.approved': (d) => `tu pago de ${pesos(d.total)} fue aprobado`,
  'payment.rejected': (d) => `tu pago fue rechazado (${d.reason})`,
  'stock.reserved': (d) => `separamos tus productos del pedido #${d.orderId}`,
  'stock.failed': (d) => `no tenemos stock de ${d.missing.join(', ')}`,
  'payment.refunded': (d) => `te devolvimos ${pesos(d.total)}`,
  'order.confirmed': (d) => `¡tu pedido #${d.orderId} está confirmado! Pronto sale para tu casa 🧉`,
  'order.cancelled': (d) => `tu pedido #${d.orderId} fue cancelado: ${d.reason}`
}

/**
 * Servicio de notificaciones: escucha todo el negocio y "manda emails" (los loguea).
 * @param {{ bus: ReturnType<typeof import('@mateshop/event-bus').createEventBus> }} ctx
 */
export function createNotificationsService({ bus }) {
  /** @type {string[]} */
  const sent = []
  for (const type of SUBSCRIPTIONS.notifications) {
    bus.on(type, (event, { logger }) => {
      const email = `📧 ${event.data.customer}: ${TEMPLATES[type](event.data)}`
      sent.push(email)
      logger.info({ to: event.data.customer, orderId: event.data.orderId }, email)
    })
  }
  return { sent }
}
