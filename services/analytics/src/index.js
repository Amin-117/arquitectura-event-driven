import { bootstrap } from '@mateshop/event-bus'
import { createAnalyticsService } from './service.js'

await bootstrap({
  service: 'analytics',
  // ID 0: al crear el grupo tarde, analytics reprocesa toda la historia del stream.
  busOptions: { startId: '0' },
  setup: (ctx) => {
    createAnalyticsService(ctx)
  }
})
