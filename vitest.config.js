import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    globalSetup: ['tests/global-setup.js'],
    // Todos los tests comparten la base 15 de Redis: corren en serie para no pisarse.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
    env: {
      LOG_LEVEL: 'silent'
    }
  }
})
