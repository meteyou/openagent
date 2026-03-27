import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { createMemoryTools } from './memory-tools.js'
import { ensureMemoryStructure, readAgentsFile, readDailyFile } from './memory.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('memory-tools', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `openagent-memtools-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    ensureMemoryStructure(tmpDir)
  })

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('creates four memory tools', () => {
    const tools = createMemoryTools(tmpDir)
    expect(tools).toHaveLength(4)

    const names = tools.map(t => t.name)
    expect(names).toContain('read_core_memory')
    expect(names).toContain('write_core_memory')
    expect(names).toContain('read_daily_memory')
    expect(names).toContain('append_daily_memory')
  })

  describe('read_core_memory', () => {
    it('reads AGENTS.md content', async () => {
      const tools = createMemoryTools(tmpDir)
      const tool = tools.find(t => t.name === 'read_core_memory')!

      const result = await tool.execute('call-1', {})

      expect(result.content[0].type).toBe('text')
      expect((result.content[0] as { type: 'text'; text: string }).text).toContain('# Agent Memory')
      expect(result.details).toEqual({ success: true })
    })
  })

  describe('write_core_memory', () => {
    it('writes and persists AGENTS.md', async () => {
      const tools = createMemoryTools(tmpDir)
      const tool = tools.find(t => t.name === 'write_core_memory')!

      const newContent = '# Updated Memory\n\n## New lesson learned\n'
      await tool.execute('call-2', { content: newContent })

      const onDisk = readAgentsFile(tmpDir)
      expect(onDisk).toBe(newContent)
    })
  })

  describe('read_daily_memory', () => {
    it('reads today\'s daily file', async () => {
      const tools = createMemoryTools(tmpDir)
      const tool = tools.find(t => t.name === 'read_daily_memory')!

      const result = await tool.execute('call-3', {})

      expect(result.content[0].type).toBe('text')
      expect((result.content[0] as { type: 'text'; text: string }).text).toContain('# Daily Memory')
    })

    it('reads specific date daily file', async () => {
      const tools = createMemoryTools(tmpDir)

      // Create a specific date file
      const dailyDir = path.join(tmpDir, 'daily')
      fs.writeFileSync(path.join(dailyDir, '2025-01-15.md'), '# Daily Memory — 2025-01-15\n\n## Special day\n', 'utf-8')

      const tool = tools.find(t => t.name === 'read_daily_memory')!
      const result = await tool.execute('call-4', { date: '2025-01-15' })

      expect((result.content[0] as { type: 'text'; text: string }).text).toContain('Special day')
    })
  })

  describe('append_daily_memory', () => {
    it('appends content to today\'s daily file', async () => {
      const tools = createMemoryTools(tmpDir)
      const tool = tools.find(t => t.name === 'append_daily_memory')!

      await tool.execute('call-5', { content: '\n## Test Note\n\nSomething important\n' })

      const dailyContent = readDailyFile(undefined, tmpDir)
      expect(dailyContent).toContain('Test Note')
      expect(dailyContent).toContain('Something important')
    })
  })
})
