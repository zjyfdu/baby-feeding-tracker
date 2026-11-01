// Local preview server: runs the real business routes against an in-memory DB.
import http from 'node:http'
import { createFakeDatabase } from './fake-db.mjs'
import { application } from '../functions/routes.mjs'

class BackendError extends Error {
  constructor(code, status = 500) {
    super(code)
    this.code = code
    this.status = status
  }
}

const db = createFakeDatabase()
const handler = application({
  db,
  requireUser: () => ({ id: 'local-dev' }),
  BackendError,
})

const port = Number(process.argv[2] ?? 8000)

const send = (res, response) => {
  res.statusCode = response.status
  response.headers.forEach((value, key) => res.setHeader(key, value))
  if (response.status === 204) {
    res.end()
    return
  }
  response
    .arrayBuffer()
    .then((buffer) => {
      res.end(Buffer.from(buffer))
    })
    .catch(() => {
      res.statusCode = 500
      res.end()
    })
}

http
  .createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = chunks.length ? Buffer.concat(chunks) : undefined
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: body && req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined,
    })
    try {
      const response = await handler({ request, requestId: crypto.randomUUID() })
      send(res, response)
    } catch (error) {
      const status = error instanceof BackendError ? error.status : 500
      const code = error instanceof BackendError ? error.code : 'internal_error'
      res.statusCode = status
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: code }))
    }
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`local function listening on http://127.0.0.1:${port}/functions/v1/app/api/health`)
  })
