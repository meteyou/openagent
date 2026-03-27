import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initDatabase, addProvider, setActiveProvider, loadProviders } from '@openagent/core'
import { HeartbeatService } from './heartbeat.js'

let tempDataDir: string
let previousDataDir: string | undefined

function writeConfig(name: string, value: object): void {
  const configDir = path.join(tempDataDir, 'config')
  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(path.join(configDir, name), JSON.stringify(value, null, 2) + '\n', 'utf-8')
}

beforeEach(() => {
  previousDataDir = process.env.DATA_DIR
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openagent-heartbeat-'))
  process.env.DATA_DIR = tempDataDir
  writeConfig('settings.json', {
    sessionTimeoutMinutes: 15,
    language: 'en',
    heartbeatIntervalMinutes: 1,
    yoloMode: true,
  })
  writeConfig('telegram.json', {
    enabled: true,
    botToken: 'telegram-token',
    adminUserIds: [12345],
    pollingMode: true,
    webhookUrl: '',
    batchingDelayMs: 2500,
  })
  writeConfig('providers.json', { providers: [] })
})

afterEach(() => {
  fs.rmSync(tempDataDir, { recursive: true, force: true })
  vi.useRealTimers()

  if (previousDataDir === undefined) {
    delete process.env.DATA_DIR
  } else {
    process.env.DATA_DIR = previousDataDir
  }
})

describe('HeartbeatService', () => {
  it('runs on an interval in the background', async () => {
    vi.useFakeTimers()
    const db = initDatabase(':memory:')
    addProvider({ name: 'Primary', providerType: 'openai', apiKey: 'sk-test', defaultModel: 'gpt-4o-mini' })

    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.includes('/chat/completions')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })

    const service = new HeartbeatService({ db, fetchImpl: fetchImpl as typeof fetch })
    service.start()

    await vi.runOnlyPendingTimersAsync()
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    service.stop()
    db.close()
  })

  it('notifies only on down transitions and sends recovery only when healthy again', async () => {
    const db = initDatabase(':memory:')
    addProvider({ name: 'Primary', providerType: 'openai', apiKey: 'sk-test', defaultModel: 'gpt-4o-mini' })

    const telegramBodies: Array<{ chat_id: number; text: string }> = []
    let providerAttempt = 0

    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.includes('/chat/completions')) {
        providerAttempt += 1
        if (providerAttempt <= 2) {
          throw new Error('ECONNREFUSED')
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }

      if (url.includes('api.telegram.org')) {
        telegramBodies.push(JSON.parse(String(init?.body)) as { chat_id: number; text: string })
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })

    const service = new HeartbeatService({ db, fetchImpl: fetchImpl as typeof fetch })

    const first = await service.runNow()
    expect(first.status).toBe('down')
    expect(telegramBodies).toHaveLength(1)
    expect(telegramBodies[0].text).toContain('provider is down')

    const second = await service.runNow()
    expect(second.status).toBe('down')
    expect(telegramBodies).toHaveLength(1)

    const third = await service.runNow()
    expect(third.status).toBe('healthy')
    expect(telegramBodies).toHaveLength(2)
    expect(telegramBodies[1].text).toContain('provider recovered')

    const rows = db.prepare('SELECT status FROM health_checks ORDER BY id').all() as Array<{ status: string }>
    expect(rows.map((row) => row.status)).toEqual(['down', 'down', 'healthy'])
    expect(loadProviders().providers[0].status).toBe('connected')

    db.close()
  })

  it('gracefully handles disabled telegram notifications', async () => {
    writeConfig('telegram.json', {
      enabled: false,
      botToken: '',
      adminUserIds: [],
      pollingMode: true,
      webhookUrl: '',
      batchingDelayMs: 2500,
    })

    const db = initDatabase(':memory:')
    addProvider({ name: 'Primary', providerType: 'openai', apiKey: 'sk-test', defaultModel: 'gpt-4o-mini' })

    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.includes('/chat/completions')) {
        throw new Error('ECONNREFUSED')
      }
      throw new Error(`Unexpected fetch URL: ${url}`)
    })

    const service = new HeartbeatService({ db, fetchImpl: fetchImpl as typeof fetch })
    const result = await service.runNow()

    expect(result.status).toBe('down')
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    db.close()
  })

  it('gracefully handles no provider configured and resets state when provider is switched', async () => {
    const db = initDatabase(':memory:')
    const telegramBodies: Array<{ chat_id: number; text: string }> = []

    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('api.telegram.org')) {
        telegramBodies.push(JSON.parse(String(init?.body)) as { chat_id: number; text: string })
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      if (url.includes('/chat/completions')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      throw new Error(`Unexpected fetch URL: ${url}`)
    })

    const service = new HeartbeatService({ db, fetchImpl: fetchImpl as typeof fetch })

    const unconfigured = await service.runNow()
    expect(unconfigured.status).toBe('unconfigured')
    expect(telegramBodies).toHaveLength(0)

    const first = addProvider({ name: 'First', providerType: 'openai', apiKey: 'sk-1', defaultModel: 'gpt-4o-mini' })
    const second = addProvider({ name: 'Second', providerType: 'openai', apiKey: 'sk-2', defaultModel: 'gpt-4o-mini' })

    setActiveProvider(first.id)
    service.restart({ resetState: true })
    await service.runNow()

    setActiveProvider(second.id)
    service.restart({ resetState: true })
    await service.runNow()

    expect(telegramBodies).toHaveLength(0)
    expect(service.getSnapshot().activeProvider?.id).toBe(second.id)

    db.close()
  })
})
