import { describe, expect, it } from 'vitest'
import { detectMemoryFile } from './memoryFileDetection'

describe('detectMemoryFile', () => {
  it('detects SOUL.md read as memory file', () => {
    const result = detectMemoryFile('read_file', { path: '/data/memory/SOUL.md' })
    expect(result.isMemoryFile).toBe(true)
    expect(result.label).toBe('Reading Personality')
    expect(result.icon).toBe('brain')
  })

  it('detects SOUL.md write as memory file', () => {
    const result = detectMemoryFile('write_file', { path: '/data/memory/SOUL.md' })
    expect(result.isMemoryFile).toBe(true)
    expect(result.label).toBe('Writing Personality')
    expect(result.icon).toBe('brain')
  })

  it('detects MEMORY.md as memory file', () => {
    const result = detectMemoryFile('read_file', { path: '/data/memory/MEMORY.md' })
    expect(result.isMemoryFile).toBe(true)
    expect(result.label).toBe('Reading Memory')
  })

  it('detects AGENTS.md as memory file', () => {
    const result = detectMemoryFile('Read', { path: '/data/memory/AGENTS.md' })
    expect(result.isMemoryFile).toBe(true)
    expect(result.label).toBe('Reading Agent Rules')
  })

  it('detects HEARTBEAT.md as memory file', () => {
    const result = detectMemoryFile('read_file', { path: '/data/memory/HEARTBEAT.md' })
    expect(result.isMemoryFile).toBe(true)
    expect(result.label).toBe('Reading Heartbeat Tasks')
  })

  it('detects HEARTBEAT.md write', () => {
    const result = detectMemoryFile('Write', { path: '/data/memory/HEARTBEAT.md' })
    expect(result.isMemoryFile).toBe(true)
    expect(result.label).toBe('Writing Heartbeat Tasks')
  })

  it('detects daily notes', () => {
    const result = detectMemoryFile('read_file', { path: '/data/memory/daily/2026-04-01.md' })
    expect(result.isMemoryFile).toBe(true)
    expect(result.label).toBe('Reading Daily Notes')
  })

  it('detects user profiles', () => {
    const result = detectMemoryFile('write_file', { path: '/data/memory/users/alice.md' })
    expect(result.isMemoryFile).toBe(true)
    expect(result.label).toBe('Writing User Profile')
  })

  it('returns default for non-memory file paths', () => {
    const result = detectMemoryFile('read_file', { path: '/workspace/src/index.ts' })
    expect(result.isMemoryFile).toBe(false)
    expect(result.icon).toBe('settings')
  })

  it('returns default for non-file tools', () => {
    const result = detectMemoryFile('execute_command', { command: 'ls' })
    expect(result.isMemoryFile).toBe(false)
  })

  it('handles Edit tool name for memory files', () => {
    const result = detectMemoryFile('Edit', { path: '/data/memory/MEMORY.md' })
    expect(result.isMemoryFile).toBe(true)
    expect(result.label).toBe('Writing Memory')
  })

  it('handles edit_file tool name for memory files', () => {
    const result = detectMemoryFile('edit_file', { path: '/data/memory/SOUL.md' })
    expect(result.isMemoryFile).toBe(true)
    expect(result.label).toBe('Writing Personality')
  })

  it('handles null/undefined toolArgs', () => {
    expect(detectMemoryFile('read_file', null).isMemoryFile).toBe(false)
    expect(detectMemoryFile('read_file', undefined).isMemoryFile).toBe(false)
  })

  it('handles file_path arg key', () => {
    const result = detectMemoryFile('read_file', { file_path: '/data/memory/SOUL.md' })
    expect(result.isMemoryFile).toBe(true)
    expect(result.label).toBe('Reading Personality')
  })
})
