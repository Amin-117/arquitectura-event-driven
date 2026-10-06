import { deleteKeys } from '@mateshop/event-bus'

const SALES_KEY = 'analytics:sales'
const ORDERS_KEY = 'analytics:orders'
const TOP_KEY = 'analytics:top-products'

/**
 * Servicio de analítica: dueño del estado `analytics:*`.
 * @param {{ bus: ReturnType<typeof import('@mateshop/event-bus').createEventBus>, redis: import('ioredis').Redis }} ctx
 */
export function createAnalyticsService({ bus, redis }) {
  async function summary() {
    const [sales, orders, top] = await Promise.all([
      redis.get(SALES_KEY),
      redis.get(ORDERS_KEY),
      redis.zrevrange(TOP_KEY, 0, 2, 'WITHSCORES')
    ])
    const topProducts = []
    for (let i = 0; i < top.length; i += 2) topProducts.push({ sku: top[i], qty: Number(top[i + 1]) })
    return { sales: Number(sales ?? 0), orders: Number(orders ?? 0), topProducts }
  }

  bus.on('order.confirmed', async (event, { logger }) => {
    const { total, items } = event.data
    const tx = redis.multi().incrbyfloat(SALES_KEY, total).incr(ORDERS_KEY)
    for (const { sku, qty } of items) tx.zincrby(TOP_KEY, qty, sku)
    await tx.exec()
    const s = await summary()
    const top = s.topProducts.map((p) => `${p.sku} (${p.qty})`).join(', ')
    logger.info(s, `📊 ventas: $${s.sales.toLocaleString('es-AR')} en ${s.orders} pedidos · top: ${top}`)
  })

  bus.on('demo.reset', async (_event, { logger }) => {
    await deleteKeys(redis, 'analytics:*')
    logger.info('analítica reiniciada')
  })

  return { summary }
}
