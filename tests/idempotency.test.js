import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DUPLICATES_KEY } from '@mateshop/event-bus'
import { buildEvent } from '@mateshop/contracts'
import { createHarness, waitFor } from './helpers.js'
import { startShop } from './shop.js'

const h = createHarness()
beforeEach(() => h.flush())
afterEach(() => h.close())

describe('idempotencia', () => {
  it('el mismo evento publicado dos veces produce un solo efecto', async () => {
    const redis = h.redis()
    let effects = 0
    const consumer = h.bus('consumidor').on('order.confirmed', async () => {
      effects++
    })
    await consumer.start()

    const event = buildEvent(
      'order.confirmed',
      { orderId: 'abc', customer: 'Ana', items: [{ sku: 'MATE-01', qty: 1 }], total: 5000 },
      { source: '/tests' }
    )
    const publisher = h.bus('publicador')
    await publisher.publishRaw(event)
    await publisher.publishRaw(event) // reenvío: mismo id de evento, otra entrada del stream

    await waitFor(async () => (await redis.get(DUPLICATES_KEY)) === '1', { message: 'duplicado detectado' })
    expect(effects).toBe(1)
    const [pending] = await redis.xpending('mateshop.events', 'consumidor')
    expect(pending).toBe(0) // ambas entradas con ACK
  })

  it('un payment.approved duplicado descuenta el stock una sola vez', async () => {
    const redis = h.redis()
    const shop = await startShop(h)
    const event = buildEvent(
      'payment.approved',
      { orderId: 'dup1', customer: 'Ana', items: [{ sku: 'MATE-01', qty: 3 }], total: 9000, paymentId: 'pay-1' },
      { source: '/services/payments' }
    )
    const publisher = h.bus('payments-falso')
    await publisher.publishRaw(event)
    await publisher.publishRaw(event)

    const reserved = () => shop.notifications.sent.filter((m) => m.includes('separamos tus productos'))
    await waitFor(() => reserved().length === 1, { message: 'stock reservado' })
    await waitFor(async () => Number(await redis.get(DUPLICATES_KEY)) >= 2, { message: 'duplicados detectados' })
    expect(await redis.hget('inventory:stock', 'MATE-01')).toBe('7') // 10 - 3, no 10 - 6
    expect(reserved()).toHaveLength(1)
  })

  it('cada consumer group procesa el evento una vez (difusión)', async () => {
    const counts = { a: 0, b: 0 }
    const a = h.bus('grupo-a').on('order.confirmed', () => void counts.a++)
    const b = h.bus('grupo-b').on('order.confirmed', () => void counts.b++)
    await a.start()
    await b.start()
    await h.bus('publicador').publish('order.confirmed', {
      orderId: 'x1', customer: 'Bruno', items: [{ sku: 'YERBA-03', qty: 1 }], total: 3000
    })
    await waitFor(() => counts.a === 1 && counts.b === 1, { message: 'ambos grupos' })
  })
})
