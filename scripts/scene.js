// Dispara una escena de la demo desde la terminal.
// Uso: node scripts/scene.js [burst|duplicate|poison|reset]
import { placeOrder } from './order.js'

const DASHBOARD_URL = process.env.DASHBOARD_URL ?? 'http://localhost:8080'
const name = process.argv[2]

async function serverScene(scene) {
  const res = await fetch(`${DASHBOARD_URL}/api/scenes/${scene}`, { method: 'POST' })
  const json = await res.json()
  console.log(`${res.ok ? '✔' : '✖'} ${json.mensaje}`)
  if (!res.ok) process.exitCode = 1
}

async function burst() {
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, (_, i) =>
      new Promise((r) => setTimeout(r, i * 120)).then(() => placeOrder('rafaga'))
    )
  )
  for (const r of results) {
    if (r.status === 'fulfilled') console.log(`🛒 #${r.value.response.orderId} ${r.value.body.customer} → ${r.value.body.items[0].sku}`)
    else console.log(`✖ ${r.reason.message}`)
  }
  console.log(`⚡ ${results.filter((r) => r.status === 'fulfilled').length}/10 pedidos aceptados`)
}

const SCENES = {
  burst,
  duplicate: () => serverScene('duplicate'),
  poison: () => serverScene('poison'),
  reset: () => serverScene('reset')
}

if (!SCENES[name]) {
  console.error(`Escena desconocida: ${name}. Opciones: ${Object.keys(SCENES).join(', ')}`)
  process.exit(1)
}
try {
  await SCENES[name]()
} catch (err) {
  console.error(`No se pudo ejecutar la escena: ${err.message}. ¿Está todo levantado? Probá: npm run up`)
  process.exit(1)
}
