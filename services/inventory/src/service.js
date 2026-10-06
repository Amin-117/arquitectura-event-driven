import { CATALOG_BY_SKU } from '@mateshop/contracts'
import { deleteKeys } from '@mateshop/event-bus'

/** Stock con el que arranca la demo (TERMO-04 en 0 para mostrar la compensación). */
export const INITIAL_STOCK = {
  'MATE-01': 10,
  'BOMBILLA-02': 10,
  'YERBA-03': 2,
  'TERMO-04': 0,
  'MATE-05': 8,
  'MATE-06': 3,
  'BOMBILLA-07': 12,
  'YERBA-08': 6,
  'MATERA-09': 4,
  'AZUCARERA-10': 5
}

export const STOCK_KEY = 'inventory:stock'

export class UnknownSkuError extends Error {}

// Reserva atómica de todos los ítems: o se descuentan todos o ninguno.
const RESERVE_SCRIPT = `
local missing = {}
for i = 1, #ARGV, 2 do
  local have = tonumber(redis.call('HGET', KEYS[1], ARGV[i]) or '0')
  if have < tonumber(ARGV[i + 1]) then table.insert(missing, ARGV[i]) end
end
if #missing > 0 then return missing end
for i = 1, #ARGV, 2 do
  redis.call('HINCRBY', KEYS[1], ARGV[i], -tonumber(ARGV[i + 1]))
end
return {}
`

/**
 * Servicio de inventario: dueño del estado `inventory:*`.
 * Cada cambio de stock se publica como `stock.updated` para que otros (la tienda) armen su propia vista.
 * @param {{ bus: ReturnType<typeof import('@mateshop/event-bus').createEventBus>, redis: import('ioredis').Redis, logger: import('pino').Logger }} ctx
 */
export function createInventoryService({ bus, redis, logger }) {
  async function publishStock(skus) {
    const values = await redis.hmget(STOCK_KEY, ...skus)
    for (const [i, sku] of skus.entries()) {
      await bus.publish('stock.updated', { sku, available: Number(values[i] ?? 0) }, { correlationid: `stock-${sku}` })
    }
  }

  /** Siembra idempotente: HSETNX no pisa el stock si ya existía. Publica el stock actual de todo. */
  async function seed() {
    const pipeline = redis.pipeline()
    for (const [sku, qty] of Object.entries(INITIAL_STOCK)) pipeline.hsetnx(STOCK_KEY, sku, qty)
    await pipeline.exec()
    logger.info({ stock: await redis.hgetall(STOCK_KEY) }, 'stock sembrado')
    await publishStock(Object.keys(INITIAL_STOCK))
  }

  /** Reposición desde la API de administración del propio servicio. */
  async function replenish(sku, qty) {
    if (!CATALOG_BY_SKU[sku]) throw new UnknownSkuError(`producto desconocido: ${sku}`)
    const available = await redis.hincrby(STOCK_KEY, sku, qty)
    logger.info({ sku, qty, available }, 'stock repuesto')
    await bus.publish('stock.replenished', { sku, qty, available }, { correlationid: `stock-${sku}` })
    await bus.publish('stock.updated', { sku, available }, { correlationid: `stock-${sku}` })
    return { sku, qty, available }
  }

  bus.on('payment.approved', async (event, { logger: log }) => {
    const { orderId, customer, items } = event.data
    const totals = new Map()
    for (const { sku, qty } of items) totals.set(sku, (totals.get(sku) ?? 0) + qty)
    const args = [...totals].flat().map(String)

    /** @type {string[]} */
    const missing = await redis.eval(RESERVE_SCRIPT, 1, STOCK_KEY, ...args)
    if (missing.length > 0) {
      await bus.publish(
        'stock.failed',
        { orderId, customer, items, missing, reason: `sin stock de ${missing.join(', ')}` },
        { correlationid: event.correlationid }
      )
      return
    }
    log.info({ orderId, stock: await redis.hgetall(STOCK_KEY) }, 'stock reservado')
    await bus.publish('stock.reserved', { orderId, customer, items }, { correlationid: event.correlationid })
    await publishStock([...totals.keys()])
  })

  bus.on('demo.reset', async (_event, { logger: log }) => {
    await deleteKeys(redis, 'inventory:*')
    log.info('inventario reiniciado')
    await seed()
  })

  return { seed, replenish }
}
