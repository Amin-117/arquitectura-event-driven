import { fileURLToPath } from 'node:url'
import express from 'express'

const publicDir = fileURLToPath(new URL('../public', import.meta.url))

/**
 * API de LECTURA de la tienda + archivos estáticos. Las escrituras (crear pedidos, reponer stock)
 * las hace el navegador directo contra orders e inventory.
 * @param {ReturnType<typeof import('./service.js').createStorefrontReadModel>} store
 */
export function createHttpApp(store) {
  const app = express()

  app.use(express.static(publicDir))
  app.get('/admin', (_req, res) => res.sendFile(`${publicDir}/admin.html`))

  app.get('/api/catalog', async (_req, res) => res.json(await store.catalog()))

  app.get('/api/orders/:id', async (req, res) => {
    const order = await store.getOrder(req.params.id)
    if (!order) return res.status(404).json({ error: 'pedido no encontrado (todavía)' })
    res.json(order)
  })

  app.get('/api/orders', async (req, res) => {
    const email = String(req.query.email ?? '').trim()
    if (!email) return res.status(400).json({ error: 'falta el email' })
    res.json(await store.ordersByEmail(email))
  })

  app.get('/api/notifications', async (req, res) => {
    const email = String(req.query.email ?? '').trim()
    if (!email) return res.status(400).json({ error: 'falta el email' })
    res.json(await store.inbox(email))
  })

  app.get('/api/admin/orders', async (_req, res) => res.json(await store.allOrders()))

  // Las URLs de los otros servicios se arman en el navegador con su propio host (sirve también desde el celular).
  app.get('/api/config', (_req, res) =>
    res.json({ ordersPort: 3000, inventoryPort: 3001, dashboardPort: 8080 })
  )

  app.get('/health', (_req, res) => res.json({ estado: 'ok' }))
  app.use('/api', (_req, res) => res.status(404).json({ error: 'ruta no encontrada' }))

  return app
}
