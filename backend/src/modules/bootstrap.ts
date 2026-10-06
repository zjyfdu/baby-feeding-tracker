import { Router, Request, Response } from 'express'
import { listDayCounts, listRecentWindow, latestTimes } from './events.js'
import { readOptions } from './options.js'

export const bootstrapRouter: Router = Router()

/**
 * Everything the app needs for its first paint, in a single round trip:
 * options, the records of the last few days, and a per-day summary so the date
 * tabs cover the whole history without loading every row.
 */
bootstrapRouter.get('/', async (req: Request, res: Response) => {
  const tz = typeof req.query.tz === 'string' && req.query.tz ? req.query.tz : 'Asia/Shanghai'
  const days = Math.min(Number(req.query.days) || 14, 60)
  const [options, events, dayCounts, latest] = await Promise.all([
    readOptions(),
    listRecentWindow(days),
    listDayCounts(tz),
    latestTimes(),
  ])
  res.json({ options, events, dayCounts, latest })
})
