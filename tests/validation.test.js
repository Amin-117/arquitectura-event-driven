import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { buildEvent } from '@mateshop/contracts'
import { createHarness, waitFor, readDlq } from './helpers.js'

const h = createHarness()
beforeEach(() => h.flush())
afterEach(() => h.close())

describe('validación de contratos', () => {
  it('un evento que no cumple el schema va directo a la DLQ sin llegar al handler', async () => {
    const redis = h.redis()
    let called = false
    const consumer = h.bus('payments').on('order.created', () => {
      called = true
    })
    await consumer.start()

    const poison = buildEvent('order.created', { orderId: 'p1', items: 'veneno' }, { source: '/tests' })
    await h.bus('tests').publishRaw(poison)

    const [dead] = await waitFor(async () => {
      const dlq = await readDlq(redis)
      return dlq.length ? dlq : null
    }, { message: 'evento inválido en la DLQ' })
    expect(called).toBe(false)
    expect(dead.error).toMatch(/schema inválido/)
    expect(dead.error).toMatch(/data\.customer/)
    expect(dead.deliveries).toBe('1')
  })

  it('un JSON roto también va a la DLQ', async () => {
    const redis = h.redis()
    await h.bus('payments').on('order.created', () => {}).start()
    await redis.xadd('mateshop.events', '*', 'event', '{no es json', 'type', 'order.created')
    await waitFor(async () => (await redis.xlen('mateshop.dlq')) === 1, { message: 'JSON roto en la DLQ' })
  })

  it('publish() rechaza un evento inválido antes de mandarlo', async () => {
    const bus = h.bus('orders')
    await expect(bus.publish('order.created', { orderId: 'x' })).rejects.toThrow(/evento inválido/)
  })
})
