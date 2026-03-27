import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { WebSocket } from 'ws'
import { createApp } from './app.js'
import { initDatabase } from '@openagent/core'
import type { Database } from '@openagent/core'
import { setupWebSocketChat } from './ws-chat.js'
import { generateAccessToken } from './auth.js'

let db: Database
let server: http.Server
let wss: import('ws').WebSocketServer
let port: number
let baseUrl: string

beforeAll(async () => {
  db = initDatabase(':memory:')
  const app = createApp({ db })
  server = http.createServer(app)
  wss = setupWebSocketChat(server, db, null)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  port = (server.address() as { port: number }).port
  baseUrl = `http://localhost:${port}`
})

afterAll(async () => {
  // Close all WebSocket connections first
  for (const client of wss.clients) {
    client.terminate()
  }
  wss.close()
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  )
})

describe('health endpoint', () => {
  it('GET /health returns status ok', async () => {
    const res = await fetch(`${baseUrl}/health`)
    const body = (await res.json()) as Record<string, unknown>
    expect(res.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(typeof body.uptime).toBe('number')
    expect(typeof body.version).toBe('string')
  })
})

describe('auth flow', () => {
  it('POST /api/auth/login succeeds with valid credentials', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin' }),
    })
    const body = (await res.json()) as Record<string, unknown>
    expect(res.status).toBe(200)
    expect(body.accessToken).toBeDefined()
    expect(body.refreshToken).toBeDefined()
    expect(body.user).toEqual(
      expect.objectContaining({ username: 'admin', role: 'admin' })
    )
  })

  it('POST /api/auth/login fails with invalid credentials', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong' }),
    })
    expect(res.status).toBe(401)
  })

  it('POST /api/auth/login fails with missing fields', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/auth/refresh returns new tokens', async () => {
    // Login first
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin' }),
    })
    const loginBody = (await loginRes.json()) as { refreshToken: string }

    const res = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: loginBody.refreshToken }),
    })
    const body = (await res.json()) as Record<string, unknown>
    expect(res.status).toBe(200)
    expect(body.accessToken).toBeDefined()
    expect(body.refreshToken).toBeDefined()
  })

  it('POST /api/auth/refresh fails with invalid token', async () => {
    const res = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'invalid-token' }),
    })
    expect(res.status).toBe(401)
  })

  it('protected routes reject unauthenticated requests with 401', async () => {
    const res = await fetch(`${baseUrl}/api/chat/history`)
    expect(res.status).toBe(401)
  })

  it('protected routes accept valid JWT', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin' }),
    })
    const { accessToken } = (await loginRes.json()) as { accessToken: string }

    const res = await fetch(`${baseUrl}/api/chat/history`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(res.status).toBe(200)
  })
})

describe('chat history API', () => {
  it('GET /api/chat/history returns paginated messages', async () => {
    // Login
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin' }),
    })
    const { accessToken } = (await loginRes.json()) as { accessToken: string }

    // Insert some test messages
    const userId = (db.prepare('SELECT id FROM users WHERE username = ?').get('admin') as { id: number }).id
    db.prepare('INSERT INTO chat_messages (session_id, user_id, role, content) VALUES (?, ?, ?, ?)').run('test-session', userId, 'user', 'Hello')
    db.prepare('INSERT INTO chat_messages (session_id, user_id, role, content) VALUES (?, ?, ?, ?)').run('test-session', userId, 'assistant', 'Hi there!')

    const res = await fetch(`${baseUrl}/api/chat/history?session_id=test-session`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const body = (await res.json()) as { messages: unknown[]; pagination: { total: number } }
    expect(res.status).toBe(200)
    expect(body.messages.length).toBe(2)
    expect(body.pagination.total).toBe(2)
  })
})

describe('WebSocket chat', () => {
  interface BufferedWs {
    ws: WebSocket
    messages: Record<string, unknown>[]
    waitForMessage: () => Promise<Record<string, unknown>>
  }

  function connectWs(token?: string): Promise<BufferedWs> {
    const url = token
      ? `ws://localhost:${port}/ws/chat?token=${token}`
      : `ws://localhost:${port}/ws/chat`
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      const messages: Record<string, unknown>[] = []
      let pendingResolve: ((msg: Record<string, unknown>) => void) | null = null

      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString()) as Record<string, unknown>
        if (pendingResolve) {
          const r = pendingResolve
          pendingResolve = null
          r(parsed)
        } else {
          messages.push(parsed)
        }
      })

      const waitForMessage = (): Promise<Record<string, unknown>> => {
        if (messages.length > 0) {
          return Promise.resolve(messages.shift()!)
        }
        return new Promise((res) => {
          pendingResolve = res
        })
      }

      ws.on('open', () => resolve({ ws, messages, waitForMessage }))
      ws.on('error', reject)
    })
  }

  it('authenticates via query param token', async () => {
    const token = generateAccessToken({ userId: 1, username: 'admin', role: 'admin' })
    const { ws, waitForMessage } = await connectWs(token)
    const msg = await waitForMessage()
    expect(msg.type).toBe('system')
    expect(msg.text).toBe('Authenticated')
    expect(msg.sessionId).toBeDefined()
    ws.close()
  })

  it('rejects unauthenticated messages', async () => {
    const { ws, waitForMessage } = await connectWs()
    ws.send(JSON.stringify({ type: 'message', content: 'hello' }))
    const msg = await waitForMessage()
    expect(msg.type).toBe('error')
    expect(msg.error).toContain('Not authenticated')
    ws.close()
  })

  it('authenticates via first message JWT', async () => {
    const token = generateAccessToken({ userId: 1, username: 'admin', role: 'admin' })
    const { ws, waitForMessage } = await connectWs()
    ws.send(JSON.stringify({ type: 'message', content: token }))
    const msg = await waitForMessage()
    expect(msg.type).toBe('system')
    expect(msg.text).toBe('Authenticated')
    ws.close()
  })

  it('sends message and receives agent-not-available error', async () => {
    const token = generateAccessToken({ userId: 1, username: 'admin', role: 'admin' })
    const { ws, waitForMessage } = await connectWs(token)
    await waitForMessage() // auth confirmation

    ws.send(JSON.stringify({ type: 'message', content: 'Hello agent' }))
    const msg = await waitForMessage()
    expect(msg.type).toBe('error')
    expect(msg.error).toContain('Agent core not available')
    ws.close()
  })

  it('/new command resets session', async () => {
    const token = generateAccessToken({ userId: 1, username: 'admin', role: 'admin' })
    const { ws, waitForMessage } = await connectWs(token)
    const authMsg = await waitForMessage() as { sessionId: string }
    const oldSessionId = authMsg.sessionId

    ws.send(JSON.stringify({ type: 'command', content: '/new' }))
    const msg = await waitForMessage()
    expect(msg.type).toBe('system')
    expect(msg.text).toContain('Session reset')
    expect(msg.sessionId).toBeDefined()
    expect(msg.sessionId).not.toBe(oldSessionId)
    ws.close()
  })

  it('/stop command sends abort confirmation', async () => {
    const token = generateAccessToken({ userId: 1, username: 'admin', role: 'admin' })
    const { ws, waitForMessage } = await connectWs(token)
    await waitForMessage() // auth

    ws.send(JSON.stringify({ type: 'command', content: '/stop' }))
    const msg = await waitForMessage()
    expect(msg.type).toBe('system')
    expect(msg.text).toContain('aborted')
    ws.close()
  })
})
