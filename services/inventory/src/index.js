import { bootstrap } from '@mateshop/event-bus'
import { createInventoryService } from './service.js'
import { createHttpApp } from './http.js'

const PORT = Number(process.env.PORT ?? 3001)

await bootstrap({
  service: 'inventory',
  setup: async (ctx) => {
    const inventory = createInventoryService(ctx)
    await inventory.seed()
    const server = createHttpApp(inventory, ctx.logger).listen(PORT, () =>
      ctx.logger.info({ port: PORT }, `admin de stock en http://localhost:${PORT}`)
    )
    return { close: () => new Promise((resolve) => server.close(() => resolve())) }
  }
})
