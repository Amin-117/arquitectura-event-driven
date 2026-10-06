import { bootstrap } from '@mateshop/event-bus'
import { createNotificationsService } from './service.js'

await bootstrap({
  service: 'notifications',
  setup: (ctx) => {
    createNotificationsService(ctx)
  }
})
