import { describe, it, expect, vi } from 'vitest'
import http from 'node:http'
import { WebSocket } from 'ws'
import { initDatabase } from '@openagent/core'
import type { AgentCore, ResponseChunk } from '@openagent/core'
import { createApp } from './app.js'
import { generateAccessToken } from './auth.js'
import { setupWebSocketChat } from './ws-chat.js'
import { ChatEventBus } from './chat-event-bus.js'

interface BufferedWs {
  ws: WebSocket
  waitForMessage: () => Promise<Record<string, unknown>>
  expectNoMessageWithin: (ms: number) => Promise<void>
}

function connectWs(port: number, token: string): Promise<BufferedWs> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/chat?token=${token}`)
    const messages: Record<string, unknown>[] = []
    let pendingResolve: ((msg: Record<string, unknown>) => void) | null = null

    ws.on('message', (data) => {
      const parsed = JSON.parse(data.toString()) as Record<string, unknown>
      if (pendingResolve) {
        const current = pendingResolve
        pendingResolve = null
        current(parsed)
      } else {
        messages.push(parsed)
      }
    })

    ws.on('open', () => {
      resolve({
        ws,
        waitForMessage: () => {
          if (messages.length > 0) {
            return Promise.resolve(messages.shift()!)
          }

          return new Promise((res) => {
            pendingResolve = res
          })
        },
        expectNoMessageWithin: async (ms: number) => {
          if (messages.length > 0) {
            throw new Error(`Expected no queued message, got: ${JSON.stringify(messages[0])}`)
          }

          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, ms)
            pendingResolve = (msg) => {
              clearTimeout(timer)
              pendingResolve = null
              reject(new Error(`Expected no message within ${ms}ms, got: ${JSON.stringify(msg)}`))
            }
          })
        },
      })
    })

    ws.on('error', reject)
  })
}

describe('setupWebSocketChat kill switch', () => {
  it('aborts the active agent task when /stop is sent from web chat', async () => {
    const db = initDatabase(':memory:')
    let releaseTask!: () => void
    const blocked = new Promise<void>((resolve) => {
      releaseTask = resolve
    })

    const mockSessionManager = {
      getOrCreateSession: vi.fn(() => ({ id: 'session-1-mock', userId: '1', source: 'web', startedAt: Date.now(), lastActivity: Date.now(), messageCount: 0, summaryWritten: false, restored: false })),
    }
    const agentCore = {
      sendMessage: vi.fn(async function* (): AsyncGenerator<ResponseChunk> {
        yield { type: 'text', text: 'Working...' }
        await blocked
        yield { type: 'done' }
      }),
      abort: vi.fn(),
      resetSession: vi.fn(),
      getSessionManager: vi.fn(() => mockSessionManager),
    } as unknown as AgentCore

    const app = createApp({ db })
    const server = http.createServer(app)
    const { wss } = setupWebSocketChat(server, db, agentCore)

    await new Promise<void>((resolve) => server.listen(0, resolve))
    const port = (server.address() as { port: number }).port
    const token = generateAccessToken({ userId: 1, username: 'admin', role: 'admin' })

    try {
      const { ws, waitForMessage } = await connectWs(port, token)
      await waitForMessage() // authenticated

      ws.send(JSON.stringify({ type: 'message', content: 'hello' }))
      const firstChunk = await waitForMessage()
      expect(firstChunk.type).toBe('text')
      expect(firstChunk.text).toBe('Working...')

      ws.send(JSON.stringify({ type: 'command', content: '/stop' }))
      const stopMessage = await waitForMessage()
      expect(stopMessage.type).toBe('system')
      expect(stopMessage.text).toBe('Task aborted. No queued messages.')
      expect(agentCore.abort).toHaveBeenCalledTimes(1)

      releaseTask()
      ws.close()
    } finally {
      await new Promise<void>((resolve) => setTimeout(resolve, 20))
      for (const client of wss.clients) {
        client.terminate()
      }
      wss.close()
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      )
    }
  })

  it('emits only one session_end for /new when the backend broadcasts the divider', async () => {
    const db = initDatabase(':memory:')
    const chatEventBus = new ChatEventBus()
    const mockSessionManager = {
      getOrCreateSession: vi.fn(() => ({ id: 'session-1-mock', userId: '1', source: 'web', startedAt: Date.now(), lastActivity: Date.now(), messageCount: 0, summaryWritten: false, restored: false })),
    }
    const agentCore = {
      sendMessage: vi.fn(),
      abort: vi.fn(),
      resetSession: vi.fn(async () => {
        chatEventBus.broadcast({
          type: 'session_end',
          userId: 1,
          source: 'web',
          text: 'Summary once.',
        })
        return 'Summary once.'
      }),
      getSessionManager: vi.fn(() => mockSessionManager),
    } as unknown as AgentCore

    const app = createApp({ db })
    const server = http.createServer(app)
    const { wss } = setupWebSocketChat(server, db, agentCore, undefined, chatEventBus)

    await new Promise<void>((resolve) => server.listen(0, resolve))
    const port = (server.address() as { port: number }).port
    const token = generateAccessToken({ userId: 1, username: 'admin', role: 'admin' })

    try {
      const { ws, waitForMessage, expectNoMessageWithin } = await connectWs(port, token)
      await waitForMessage() // authenticated

      ws.send(JSON.stringify({ type: 'command', content: '/new' }))
      const sessionEnd = await waitForMessage()
      expect(sessionEnd.type).toBe('session_end')
      expect(sessionEnd.text).toBe('Summary once.')
      await expectNoMessageWithin(30)
      ws.close()
    } finally {
      for (const client of wss.clients) {
        client.terminate()
      }
      wss.close()
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      )
    }
  })

  it('treats /kill as an alias for /stop over web chat', async () => {
    const db = initDatabase(':memory:')
    const mockSessionManager2 = {
      getOrCreateSession: vi.fn(() => ({ id: 'session-1-mock', userId: '1', source: 'web', startedAt: Date.now(), lastActivity: Date.now(), messageCount: 0, summaryWritten: false, restored: false })),
    }
    const agentCore = {
      sendMessage: vi.fn(),
      abort: vi.fn(),
      resetSession: vi.fn(),
      getSessionManager: vi.fn(() => mockSessionManager2),
    } as unknown as AgentCore

    const app = createApp({ db })
    const server = http.createServer(app)
    const { wss } = setupWebSocketChat(server, db, agentCore)

    await new Promise<void>((resolve) => server.listen(0, resolve))
    const port = (server.address() as { port: number }).port
    const token = generateAccessToken({ userId: 1, username: 'admin', role: 'admin' })

    try {
      const { ws, waitForMessage } = await connectWs(port, token)
      await waitForMessage() // authenticated

      ws.send(JSON.stringify({ type: 'command', content: '/kill' }))
      const stopMessage = await waitForMessage()
      expect(stopMessage.type).toBe('system')
      expect(stopMessage.text).toBe('Nothing to stop.')
      expect(agentCore.abort).not.toHaveBeenCalled()
      ws.close()
    } finally {
      for (const client of wss.clients) {
        client.terminate()
      }
      wss.close()
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      )
    }
  })
})
