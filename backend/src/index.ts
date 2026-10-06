import { createApp } from './app.js'
import { env } from './config/env.js'
import { logger } from './config/logger.js'
import { ensureReady } from './config/database.js'

const startServer = () => {
  const app = createApp()

  app.listen(env.PORT, '0.0.0.0', () => {
    console.log(`Server listening on 0.0.0.0:${env.PORT}${env.API_PREFIX}`)
  })

  // The database container may still be starting; warm it up in the background
  // so the first request after a cold start already finds a ready schema.
  void ensureReady().catch((error) => logger.error({ err: error }, 'Database unavailable'))
}

// Handle graceful shutdown silently
process.on('SIGTERM', async () => {
  process.exit(0)
})

process.on('SIGINT', async () => {
  process.exit(0)
})

startServer()
