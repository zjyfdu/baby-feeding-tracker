import fs from 'fs'
import path from 'path'
import express, { Application } from 'express'
import cors from 'cors'
import compression from 'compression'
import 'express-async-errors'
import { env } from './config/env.js'
import { ensureReady } from './config/database.js'
import { errorHandler } from './middleware/errorHandler.js'
import { httpLogger } from './middleware/logger.js'
import { systemRouter } from './modules/system.js'
import { bootstrapRouter } from './modules/bootstrap.js'
import { eventsRouter } from './modules/events.js'
import { optionsRouter } from './modules/options.js'
import { exportRouter } from './modules/exportData.js'
// ============================================
// Add your domain module imports here
// ============================================
// Example: Product Module
// import { productRouter } from './modules/product.js'

export const createApp = (): Application => {
  const app = express()

  // HTTP request logging
  app.use(httpLogger)

  app.use(
    cors({
      origin: env.CORS_ORIGIN === '*' ? '*' : env.CORS_ORIGIN,
      credentials: env.CORS_ORIGIN !== '*',
    })
  )

  // Body parsing and compression
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))
  app.use(compression())

  // Wait for the database instead of failing while it is still warming up.
  app.use(env.API_PREFIX, async (_req, res, next) => {
    try {
      await Promise.race([
        ensureReady(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 20000)),
      ])
      next()
    } catch {
      res.status(503).json({ error: '数据库启动中，请稍后重试' })
    }
  })

  // API routes - System & Health
  app.use(env.API_PREFIX, systemRouter)

  // Domain routes - Baby care tracker (feeding & diaper events)
  app.use(`${env.API_PREFIX}/bootstrap`, bootstrapRouter)
  app.use(`${env.API_PREFIX}/events`, eventsRouter)
  app.use(`${env.API_PREFIX}/options`, optionsRouter)
  app.use(`${env.API_PREFIX}/export`, exportRouter)

  // ============================================
  // Add your domain module routes here
  // ============================================
  // Example: Product Module
  // app.use(`${env.API_PREFIX}/products`, productRouter)

  // Serve the built web app from the same port (single-port deployment).
  // Looks for frontend/dist relative to the current working directory.
  const distDir = [
    path.resolve(process.cwd(), 'frontend/dist'),
    path.resolve(process.cwd(), '../frontend/dist'),
  ].find((p) => fs.existsSync(path.join(p, 'index.html')))

  if (distDir) {
    app.use(express.static(distDir, { index: false, maxAge: '1h' }))
    app.get('*', (req, res, next) => {
      if (req.path.startsWith(env.API_PREFIX)) return next()
      res.sendFile(path.join(distDir, 'index.html'))
    })
  }

  // Error handling
  app.use(errorHandler)

  return app
}
