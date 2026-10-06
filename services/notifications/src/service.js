import { ORDER_FLOW_TYPES } from '@mateshop/contracts'
import { deleteKeys } from '@mateshop/event-bus'

const pesos = (n) => `$${Number(n).toLocaleString('es-AR')}`
const contactKey = (orderId) => `notifications:order:${orderId}`

/** Asunto y cuerpo del "email" para cada tipo de evento. */
const TEMPLATES = {
  'order.created': (d) => ['Recibimos tu pedido', `Recibimos tu pedido #${d.orderId} por ${pesos(d.total)}. Ya estamos procesando el pago.`],
  'payment.approved': (d) => ['Pago aprobado', `Tu pago de ${pesos(d.total)} fue aprobado.`],
  'payment.rejected': (d) => ['Pago rechazado', `Tu pago fue rechazado (${d.reason}). No se te cobró nada.`],
  'stock.reserved': (d) => ['Productos separados', `Ya separamos tus productos del pedido #${d.orderId}.`],
  'stock.failed': (d) => ['Sin stock', `No tenemos stock de ${d.missing.join(', ')}.`],
  'payment.refunded': (d) => ['Te devolvimos el dinero', `Te devolvimos ${pesos(d.total)} porque no había stock suficiente.`],
  'order.confirmed': (d) => ['¡Pedido confirmado! 🧉', `¡Tu pedido #${d.orderId} está confirmado! Pronto sale para tu casa.`],
  'order.cancelled': (d) => ['Pedido cancelado', `Tu pedido #${d.orderId} fue cancelado: ${d.reason}.`]
}

/**
 * Servicio de notificaciones: escucha el ciclo de vida del pedido, "manda emails" (los loguea)
 * y publica `notification.sent`. Es dueño del estado `notifications:*` (email de cada pedido).
 * @param {{ bus: ReturnType<typeof import('@mateshop/event-bus').createEventBus>, redis: import('ioredis').Redis }} ctx
 */
export function createNotificationsService({ bus, redis }) {
  /** @type {string[]} */
  const sent = []

  for (const type of ORDER_FLOW_TYPES) {
    bus.on(type, async (event, { logger }) => {
      const { orderId, customer } = event.data
      // Solo order.created trae el email: lo guardamos en nuestro propio estado para los eventos siguientes.
      if (type === 'order.created' && event.data.email) {
        await redis.hset(contactKey(orderId), { email: event.data.email, customer })
        await redis.expire(contactKey(orderId), 7 * 86400)
      }

      const [asunto, cuerpo] = TEMPLATES[type](event.data)
      const email = `📧 ${customer}: ${cuerpo}`
      sent.push(email)
      logger.info({ to: customer, orderId }, email)

      const to = await redis.hget(contactKey(orderId), 'email')
      if (to) {
        await bus.publish('notification.sent', { email: to, asunto, cuerpo, orderId }, { correlationid: event.correlationid })
      }
    })
  }

  bus.on('demo.reset', async (_event, { logger }) => {
    const deleted = await deleteKeys(redis, 'notifications:*')
    logger.info({ deleted }, 'estado de notificaciones reiniciado')
  })

  return { sent }
}
