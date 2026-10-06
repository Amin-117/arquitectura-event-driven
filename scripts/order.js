// Crea un pedido de ejemplo contra la API de orders y espera a ver cómo termina la saga.
// Uso: node scripts/order.js [normal|rechazado|sin-stock|rafaga]
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildOrder } from '../services/dashboard/public/presets.js'

const ORDERS_URL = process.env.ORDERS_URL ?? 'http://localhost:3000'
const KINDS = ['normal', 'rechazado', 'sin-stock', 'rafaga']

export async function placeOrder(kind) {
  const body = buildOrder(kind)
  const res = await fetch(`${ORDERS_URL}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(json)}`)
  return { body, response: json, status: res.status }
}

export async function waitForResult(orderId, timeoutMs = 8000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const order = await (await fetch(`${ORDERS_URL}/orders/${orderId}`)).json()
    if (order.status && order.status !== 'PENDING') return order
    await new Promise((r) => setTimeout(r, 250))
  }
  return null
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMain) {
  const kind = process.argv[2] ?? 'normal'
  if (!KINDS.includes(kind)) {
    console.error(`Tipo de pedido desconocido: ${kind}. Opciones: ${KINDS.join(', ')}`)
    process.exit(1)
  }
  try {
    const { body, response, status } = await placeOrder(kind)
    const items = body.items.map((i) => `${i.qty}× ${i.sku}`).join(', ')
    console.log(`🛒 ${body.customer} pidió ${items} por $${body.total.toLocaleString('es-AR')}`)
    console.log(`   → HTTP ${status} Accepted · pedido #${response.orderId} en ${response.status}`)
    console.log('   … esperando que la saga termine (mirá el panel en http://localhost:8080)')
    const final = await waitForResult(response.orderId)
    if (!final) console.log('   ⏳ sigue PENDING: ¿está caído algún servicio?')
    else if (final.status === 'CONFIRMED') console.log(`   ✅ CONFIRMED`)
    else console.log(`   ❌ CANCELLED: ${final.reason}`)
  } catch (err) {
    console.error(`No se pudo crear el pedido: ${err.message}`)
    console.error(`¿Está levantada la API en ${ORDERS_URL}? Probá: npm run up`)
    process.exit(1)
  }
}
