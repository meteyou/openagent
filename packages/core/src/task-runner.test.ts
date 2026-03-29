import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { initDatabase } from './database.js'
import { TaskStore } from './task-store.js'
import { TaskRunner, formatTaskInjection } from './task-runner.js'
import type { TaskRunnerOptions } from './task-runner.js'
import type { Database } from './database.js'
import type { ProviderConfig } from './provider-config.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Mock estimateCost to avoid needing a real model
vi.mock('./provider-config.js', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>
  return {
    ...original,
    estimateCost: vi.fn(() => 0.001),
  }
})

// Mock the PiAgent to avoid actual LLM calls
vi.mock('@mariozechner/pi-agent-core', () => {
  return {
    Agent: vi.fn().mockImplementation((_options: unknown) => {
      let subscribeFn: ((event: unknown) => void) | null = null
      const messages: unknown[] = []

      return {
        subscribe: vi.fn((fn: (event: unknown) => void) => {
          subscribeFn = fn
          return () => { subscribeFn = null }
        }),
        prompt: vi.fn(async () => {
          // Simulate a successful completion with assistant message
          if (subscribeFn) {
            subscribeFn({
              type: 'message_end',
              message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'STATUS: completed\nSUMMARY: Task done successfully' }],
                provider: 'test-provider',
                model: 'test-model',
                usage: {
                  input: 100,
                  output: 50,
                  cacheRead: 0,
                  cacheWrite: 0,
                  cost: { total: 0.001 },
                },
              },
            })
            subscribeFn({
              type: 'agent_end',
              messages: [],
            })
          }
          // Add message to state
          messages.push({
            role: 'assistant',
            content: [{ type: 'text', text: 'STATUS: completed\nSUMMARY: Task done successfully' }],
          })
        }),
        abort: vi.fn(),
        state: {
          get messages() { return messages },
        },
      }
    }),
  }
})

const mockProvider: ProviderConfig = {
  id: 'test-provider-id',
  name: 'test-provider',
  type: 'openai',
  providerType: 'openai',
  provider: 'openai',
  baseUrl: 'http://localhost:1234',
  apiKey: 'test-key',
  defaultModel: 'test-model',
  models: [],
  status: 'connected',
  authMethod: 'api-key',
}

describe('TaskRunner', () => {
  let db: Database
  let store: TaskStore
  let runner: TaskRunner
  const tmpFiles: string[] = []
  let onTaskCompleteCalls: { taskId: string; injection: string }[] = []

  function tmpDbPath(): string {
    const p = path.join(os.tmpdir(), `openagent-runner-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
    tmpFiles.push(p)
    return p
  }

  beforeEach(() => {
    db = initDatabase(tmpDbPath())
    store = new TaskStore(db)
    onTaskCompleteCalls = []

    const options: TaskRunnerOptions = {
      db,
      buildModel: () => ({} as any),
      getApiKey: async () => 'test-key',
      tools: [],
      memoryDir: undefined,
      onTaskComplete: (taskId: string, injection: string) => {
        onTaskCompleteCalls.push({ taskId, injection })
      },
    }

    runner = new TaskRunner(options)
  })

  afterEach(() => {
    runner.dispose()
    db.close()
    for (const f of tmpFiles) {
      try { fs.unlinkSync(f) } catch { /* ignore */ }
    }
    tmpFiles.length = 0
  })

  describe('task lifecycle: create → run → complete', () => {
    it('starts a task and marks it as completed', async () => {
      const task = store.create({
        name: 'Test Task',
        prompt: 'Build something',
        triggerType: 'agent',
        sessionId: 'task-session-1',
      })

      await runner.startTask(task, mockProvider)

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100))

      const updated = store.getById(task.id)!
      expect(updated.status).toBe('completed')
      expect(updated.resultStatus).toBe('completed')
      expect(updated.resultSummary).toBe('Task done successfully')
      expect(updated.startedAt).toBeTruthy()
      expect(updated.completedAt).toBeTruthy()
      expect(updated.provider).toBe('test-provider')
      expect(updated.model).toBe('test-model')
    })

    it('calls onTaskComplete with injection message', async () => {
      const task = store.create({
        name: 'Notify Task',
        prompt: 'Do work',
        triggerType: 'agent',
      })

      await runner.startTask(task, mockProvider)
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(onTaskCompleteCalls).toHaveLength(1)
      expect(onTaskCompleteCalls[0].taskId).toBe(task.id)
      expect(onTaskCompleteCalls[0].injection).toContain('<task_injection')
      expect(onTaskCompleteCalls[0].injection).toContain('task_name="Notify Task"')
      expect(onTaskCompleteCalls[0].injection).toContain('status="completed"')
    })

    it('tracks token usage', async () => {
      const task = store.create({
        name: 'Token Task',
        prompt: 'Count tokens',
        triggerType: 'agent',
        sessionId: 'task-token-session',
      })

      await runner.startTask(task, mockProvider)
      await new Promise(resolve => setTimeout(resolve, 100))

      const updated = store.getById(task.id)!
      expect(updated.promptTokens).toBe(100)
      expect(updated.completionTokens).toBe(50)
      expect(updated.estimatedCost).toBeGreaterThan(0)

      // Check that token usage was logged to the token_usage table
      const tokenRows = db.prepare('SELECT * FROM token_usage WHERE session_id = ?').all('task-token-session') as any[]
      expect(tokenRows.length).toBeGreaterThan(0)
      expect(tokenRows[0].prompt_tokens).toBe(100)
      expect(tokenRows[0].completion_tokens).toBe(50)
    })
  })

  describe('task lifecycle: create → run → fail', () => {
    it('marks task as failed when agent throws', async () => {
      // Override mock to throw
      const { Agent } = await import('@mariozechner/pi-agent-core')
      const MockAgent = Agent as unknown as ReturnType<typeof vi.fn>
      MockAgent.mockImplementationOnce(() => {
        return {
          subscribe: vi.fn(() => () => {}),
          prompt: vi.fn(async () => {
            throw new Error('LLM API error')
          }),
          abort: vi.fn(),
          state: { messages: [] },
        }
      })

      const task = store.create({
        name: 'Fail Task',
        prompt: 'This will fail',
        triggerType: 'agent',
      })

      await runner.startTask(task, mockProvider)
      await new Promise(resolve => setTimeout(resolve, 100))

      const updated = store.getById(task.id)!
      expect(updated.status).toBe('failed')
      expect(updated.resultStatus).toBe('failed')
      expect(updated.errorMessage).toBe('LLM API error')
      expect(updated.completedAt).toBeTruthy()

      // Should still call onTaskComplete
      expect(onTaskCompleteCalls).toHaveLength(1)
      expect(onTaskCompleteCalls[0].injection).toContain('status="failed"')
    })
  })

  describe('max duration timeout', () => {
    it('aborts task via abortTask method', async () => {
      const { Agent } = await import('@mariozechner/pi-agent-core')
      const MockAgent = Agent as unknown as ReturnType<typeof vi.fn>

      let resolvePrompt: (() => void) | null = null
      let abortCalled = false
      MockAgent.mockImplementationOnce(() => {
        return {
          subscribe: vi.fn(() => () => {}),
          prompt: vi.fn(() => new Promise<void>((resolve) => {
            resolvePrompt = resolve
          })),
          abort: vi.fn(() => {
            abortCalled = true
            // When abort is called, resolve the promise so runTaskAsync catches the error
            if (resolvePrompt) resolvePrompt()
          }),
          state: { messages: [] },
        }
      })

      const task = store.create({
        name: 'Timeout Task',
        prompt: 'Long running task',
        triggerType: 'agent',
      })

      await runner.startTask(task, mockProvider)

      // Task should be running (prompt is blocked)
      expect(runner.isRunning(task.id)).toBe(true)

      // Abort it (simulates what timeout would do)
      runner.abortTask(task.id, 'Max duration exceeded')

      // abortTask updates the DB synchronously
      const updated = store.getById(task.id)!
      expect(updated.status).toBe('failed')
      expect(updated.errorMessage).toBe('Max duration exceeded')
      expect(runner.isRunning(task.id)).toBe(false)
      expect(abortCalled).toBe(true)
    })
  })

  describe('formatTaskInjection', () => {
    it('formats a completed task injection correctly', () => {
      const task = store.create({
        name: 'Format Test',
        prompt: 'test',
        triggerType: 'agent',
      })
      store.update(task.id, {
        resultStatus: 'completed',
        resultSummary: 'Built the app successfully',
        promptTokens: 5000,
        completionTokens: 2000,
      })

      const updated = store.getById(task.id)!
      const injection = formatTaskInjection(updated, 5)

      expect(injection).toContain(`task_id="${task.id}"`)
      expect(injection).toContain('task_name="Format Test"')
      expect(injection).toContain('status="completed"')
      expect(injection).toContain('trigger="agent"')
      expect(injection).toContain('duration_minutes="5"')
      expect(injection).toContain('tokens_used="7000"')
      expect(injection).toContain('Built the app successfully')
    })

    it('formats a failed task injection correctly', () => {
      const task = store.create({
        name: 'Failed Task',
        prompt: 'test',
        triggerType: 'user',
      })
      store.update(task.id, {
        status: 'failed',
        resultStatus: 'failed',
        errorMessage: 'API rate limit hit',
      })

      const updated = store.getById(task.id)!
      const injection = formatTaskInjection(updated, 2)

      expect(injection).toContain('status="failed"')
      expect(injection).toContain('trigger="user"')
      expect(injection).toContain('API rate limit hit')
    })
  })

  describe('getRunningTaskIds', () => {
    it('tracks running tasks', async () => {
      const { Agent } = await import('@mariozechner/pi-agent-core')
      const MockAgent = Agent as unknown as ReturnType<typeof vi.fn>

      let resolvePrompt: (() => void) | null = null
      MockAgent.mockImplementationOnce(() => {
        return {
          subscribe: vi.fn(() => () => {}),
          prompt: vi.fn(() => new Promise<void>((resolve) => {
            resolvePrompt = resolve
          })),
          abort: vi.fn(() => { if (resolvePrompt) resolvePrompt() }),
          state: { messages: [] },
        }
      })

      const task = store.create({
        name: 'Running Task',
        prompt: 'work',
        triggerType: 'agent',
      })

      await runner.startTask(task, mockProvider)

      expect(runner.getRunningTaskIds()).toContain(task.id)
      expect(runner.isRunning(task.id)).toBe(true)

      runner.abortTask(task.id)
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(runner.isRunning(task.id)).toBe(false)
    })
  })
})
