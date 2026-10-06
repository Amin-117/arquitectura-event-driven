import { Redis } from 'ioredis'
import { TEST_REDIS_URL } from './helpers.js'

export default async function setup() {
  const redis = new Redis(TEST_REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null })
  try {
    await redis.connect()
    await redis.ping()
  } catch {
    throw new Error(`No se pudo conectar a Redis en ${TEST_REDIS_URL}. Levantalo con: docker compose up -d redis`)
  } finally {
    redis.disconnect()
  }
}
