import { Router, Request, Response } from 'express'
import { pool } from '../config/database.js'

export const exportRouter: Router = Router()

const KIND_LABEL: Record<string, string> = {
  feeding: '吃奶',
  diaper: '尿不湿',
}

const csvCell = (value: unknown) => {
  const s = value == null ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Download every record as a spreadsheet-friendly CSV (UTF-8 BOM so Excel on
 * Windows reads Chinese correctly). Data lives inside this environment, so
 * keeping a local copy is the only backup there is.
 */
exportRouter.get('/', async (req: Request, res: Response) => {
  const tz = typeof req.query.tz === 'string' && req.query.tz ? req.query.tz : 'Asia/Shanghai'
  const { rows } = await pool.query(
    `SELECT id, kind, event_at, ended_at, type, amount, duration_min, note
     FROM events
     ORDER BY event_at DESC`
  )

  const header = ['日期', '时间', '类别', '内容', '毫升', '分钟', '结束时间', '备注']
  const lines = [header.join(',')]
  for (const r of rows) {
    const local = (value: Date | null) =>
      value == null
        ? ''
        : new Date(value).toLocaleString('zh-CN', { timeZone: tz, hour12: false })
    const [date = '', time = ''] = local(r.event_at).replace(/\//g, '-').split(' ')
    lines.push(
      [
        date,
        time,
        KIND_LABEL[r.kind as string] ?? r.kind,
        r.type,
        r.amount ?? '',
        r.duration_min ?? '',
        local(r.ended_at),
        r.note ?? '',
      ]
        .map(csvCell)
        .join(',')
    )
  }

  const today = new Date().toLocaleDateString('zh-CN', { timeZone: tz }).replace(/\//g, '-')
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="baby-records-${today}.csv"`)
  // Excel needs the BOM to detect UTF-8.
  res.send('﻿' + lines.join('\r\n'))
})
