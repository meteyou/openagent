import express from 'express'

const startTime = Date.now()

export function createApp(): express.Express {
  const app = express()

  app.use(express.json())

  app.get('/health', (_req, res) => {
    const uptimeMs = Date.now() - startTime
    const uptimeSeconds = Math.floor(uptimeMs / 1000)

    res.json({
      status: 'ok',
      uptime: uptimeSeconds,
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    })
  })

  return app
}
