import { bootstrap } from '@mateshop/event-bus'
import { createInventoryService } from './service.js'

await bootstrap({
  service: 'inventory',
  setup: async (ctx) => {
    const inventory = createInventoryService(ctx)
    await inventory.seed()
  }
})
