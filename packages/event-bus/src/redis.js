import { Redis } from 'ioredis'

/**
 * Crea una conexión a Redis. `REDIS_URL` permite elegir host y base (ej. redis://localhost:6379/15).
 * @param {string} [url]
 */
export function createRedis(url = process.env.REDIS_URL ?? 'redis://localhost:6379') {
  return new Redis(url, { maxRetriesPerRequest: null })
}

/**
 * Borra todas las claves que matchean un patrón (con SCAN, sin bloquear Redis como KEYS).
 * @param {import('ioredis').Redis} redis
 * @param {string} pattern  ej. "orders:*"
 */
export async function deleteKeys(redis, pattern) {
  let cursor = '0'
  let deleted = 0
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200)
    cursor = next
    if (keys.length) deleted += await redis.del(...keys)
  } while (cursor !== '0')
  return deleted
}
