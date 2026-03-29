import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { initDatabase } from './database.js'
import { TaskStore } from './task-store.js'
import { ScheduledTaskStore } from './scheduled-task-store.js'
import { TaskScheduler } from './task-scheduler.js'
import type { TaskRunner } from './task-runner.js'
import type { Database } from './database.js'
import type { ProviderConfig } from './provider-config.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const mockProvider: ProviderConfig = {
  id: 'test-provider',
  name: 'Test Provider',
  provider: 'openai',
  type: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'test-key',
  defaultModel: 'gpt-4o',
} as ProviderConfig

describe('TaskScheduler', () => {
  let db: Database
  let taskStore: TaskStore
  let scheduledTaskStore: ScheduledTaskStore
  let scheduler: TaskScheduler
  let mockTaskRunner: TaskRunner
  const tmpFiles: string[] = []

  function tmpDbPath(): string {
    const p = path.join(os.tmpdir(), `openagent-scheduler-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
    tmpFiles.push(p)
    return p
  }

  beforeEach(() => {
    vi.useFakeTimers()
    db = initDatabase(tmpDbPath())
    taskStore = new TaskStore(db)
    scheduledTaskStore = new ScheduledTaskStore(db)

    mockTaskRunner = {
      startTask: vi.fn().mockResolvedValue('task-id'),
      getStore: () => taskStore,
    } as unknown as TaskRunner

    scheduler = new TaskScheduler({
      db,
      taskStore,
      taskRunner: mockTaskRunner,
      getDefaultProvider: () => mockProvider,
      resolveProvider: (name: string) => name === 'test' ? mockProvider : null,
    })
  })

  afterEach(() => {
    scheduler.dispose()
    vi.useRealTimers()
    db.close()
    for (const f of tmpFiles) {
      try { fs.unlinkSync(f) } catch { /* ignore */ }
    }
    tmpFiles.length = 0
  })

  describe('start/stop', () => {
    it('loads enabled schedules on start', () => {
      scheduledTaskStore.create({ name: 'Job 1', prompt: 'test', schedule: '0 9 * * *', enabled: true })
      scheduledTaskStore.create({ name: 'Job 2', prompt: 'test', schedule: '0 10 * * *', enabled: false })

      scheduler.start()

      const active = scheduler.getActiveSchedules()
      expect(active).toHaveLength(1) // Only enabled one
    })

    it('clears all timers on stop', () => {
      scheduledTaskStore.create({ name: 'Job 1', prompt: 'test', schedule: '0 9 * * *' })
      scheduler.start()
      expect(scheduler.getActiveSchedules()).toHaveLength(1)

      scheduler.stop()
      expect(scheduler.getActiveSchedules()).toHaveLength(0)
    })
  })

  describe('registerSchedule', () => {
    it('registers a new schedule', () => {
      scheduler.start()
      const task = scheduledTaskStore.create({ name: 'New Job', prompt: 'test', schedule: '0 9 * * *' })

      scheduler.registerSchedule(task)

      const active = scheduler.getActiveSchedules()
      expect(active.find(s => s.id === task.id)).toBeTruthy()
    })

    it('re-registers an updated schedule', () => {
      scheduler.start()
      const task = scheduledTaskStore.create({ name: 'Job', prompt: 'test', schedule: '0 9 * * *' })
      scheduler.registerSchedule(task)

      const updatedTask = scheduledTaskStore.update(task.id, { schedule: '0 10 * * *' })!
      scheduler.registerSchedule(updatedTask)

      const active = scheduler.getActiveSchedules()
      expect(active).toHaveLength(1) // Replaced, not duplicated
    })

    it('does not register disabled schedules', () => {
      scheduler.start()
      const task = scheduledTaskStore.create({ name: 'Disabled Job', prompt: 'test', schedule: '0 9 * * *', enabled: false })

      scheduler.registerSchedule(task)

      const active = scheduler.getActiveSchedules()
      expect(active.find(s => s.id === task.id)).toBeUndefined()
    })
  })

  describe('unregisterSchedule', () => {
    it('removes a schedule', () => {
      scheduler.start()
      const task = scheduledTaskStore.create({ name: 'Job', prompt: 'test', schedule: '0 9 * * *' })
      scheduler.registerSchedule(task)
      expect(scheduler.getActiveSchedules()).toHaveLength(1)

      scheduler.unregisterSchedule(task.id)
      expect(scheduler.getActiveSchedules()).toHaveLength(0)
    })

    it('does nothing for non-existent schedule', () => {
      scheduler.start()
      scheduler.unregisterSchedule('non-existent')
      expect(scheduler.getActiveSchedules()).toHaveLength(0)
    })
  })

  describe('triggerNow', () => {
    it('creates and starts a task immediately', async () => {
      scheduler.start()
      const scheduledTask = scheduledTaskStore.create({
        name: 'Manual Trigger',
        prompt: 'Do something now',
        schedule: '0 9 * * *',
      })

      const taskId = await scheduler.triggerNow(scheduledTask.id)

      expect(taskId).toBeTruthy()
      expect(mockTaskRunner.startTask).toHaveBeenCalled()

      // Check last_run_at was updated
      const updated = scheduledTaskStore.getById(scheduledTask.id)!
      expect(updated.lastRunAt).toBeTruthy()
      expect(updated.lastRunTaskId).toBeTruthy()
      expect(updated.lastRunStatus).toBe('running')
    })

    it('returns null for non-existent schedule', async () => {
      scheduler.start()
      const result = await scheduler.triggerNow('non-existent')
      expect(result).toBeNull()
    })
  })
})
