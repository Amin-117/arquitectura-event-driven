import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHarness, waitFor, readEvents } from './helpers.js'
import { startShop } from './shop.js'

const h = createHarness()
beforeEach(() => h.flush())
afterEach(() => h.close())

describe('reposición de stock', () => {
  it('publica stock.replenished y stock.updated con el valor nuevo', async () => {
    const redis = h.redis()
    const shop = await startShop(h)

    const result = await shop.inventory.replenish('TERMO-04', 5)
    expect(result).toEqual({ sku: 'TERMO-04', qty: 5, available: 5 })
    expect(await redis.hget('inventory:stock', 'TERMO-04')).toBe('5')

    const events = (await readEvents(redis)).map((e) => e.event)
    expect(events).toContainEqual(expect.objectContaining({ type: 'stock.replenished', data: { sku: 'TERMO-04', qty: 5, available: 5 } }))
    const updates = events.filter((e) => e.type === 'stock.updated' && e.data.sku === 'TERMO-04')
    expect(updates.at(-1).data.available).toBe(5)
  })

  it('una reserva exitosa publica stock.updated de los productos afectados', async () => {
    const redis = h.redis()
    const shop = await startShop(h)
    await shop.orders.placeOrder({ customer: 'Ana', items: [{ sku: 'BOMBILLA-07', qty: 2 }] })

    await waitFor(async () => {
      const events = (await readEvents(redis)).map((e) => e.event)
      return events.some((e) => e.type === 'stock.updated' && e.data.sku === 'BOMBILLA-07' && e.data.available === 10)
    }, { message: 'stock.updated de BOMBILLA-07 = 10' })
  })
})
