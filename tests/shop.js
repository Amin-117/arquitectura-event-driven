import { createOrdersService } from '../services/orders/src/service.js'
import { createPaymentsService } from '../services/payments/src/service.js'
import { createInventoryService } from '../services/inventory/src/service.js'
import { createNotificationsService } from '../services/notifications/src/service.js'
import { createAnalyticsService } from '../services/analytics/src/service.js'
import { createStorefrontReadModel } from '../services/storefront/src/service.js'

/**
 * Levanta los servicios de negocio dentro del proceso de test, cada uno con su bus y su conexión.
 * Se hablan solo por Redis Streams, igual que en Docker (aquí no hay HTTP entre ellos).
 * @param {ReturnType<typeof import('./helpers.js').createHarness>} h
 */
export async function startShop(h) {
  const ctx = (service, opts) => ({ bus: h.bus(service, opts), redis: h.redis(), logger: h.logger.child({ service }) })

  const ordersCtx = ctx('orders')
  const paymentsCtx = ctx('payments')
  const inventoryCtx = ctx('inventory')
  const notificationsCtx = ctx('notifications')
  const analyticsCtx = ctx('analytics', { startId: '0' })
  const storefrontCtx = ctx('storefront', { startId: '0' })

  const orders = createOrdersService(ordersCtx)
  createPaymentsService({ ...paymentsCtx, delayMs: [0, 10] })
  const inventory = createInventoryService(inventoryCtx)
  const notifications = createNotificationsService(notificationsCtx)
  const analytics = createAnalyticsService(analyticsCtx)
  const storefront = createStorefrontReadModel(storefrontCtx)

  await inventory.seed()
  const all = [ordersCtx, paymentsCtx, inventoryCtx, notificationsCtx, analyticsCtx, storefrontCtx]
  for (const { bus } of all) await bus.start()

  return {
    orders,
    inventory,
    notifications,
    analytics,
    storefront,
    buses: Object.fromEntries(all.map(({ bus }) => [bus.service, bus]))
  }
}
