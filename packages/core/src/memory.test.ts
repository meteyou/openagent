import { describe, it, expect, afterEach } from 'vitest'
import { ensureMemoryStructure } from './memory.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('memory', () => {
  let tmpDir: string

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  function makeTmpDir(): string {
    tmpDir = path.join(os.tmpdir(), `openagent-memory-test-${Date.now()}`)
    return tmpDir
  }

  it('creates memory directory structure', () => {
    const dir = makeTmpDir()
    ensureMemoryStructure(dir)

    expect(fs.existsSync(dir)).toBe(true)
    expect(fs.existsSync(path.join(dir, 'daily'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'SOUL.md'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'AGENTS.md'))).toBe(true)
  })

  it('SOUL.md contains personality template', () => {
    const dir = makeTmpDir()
    ensureMemoryStructure(dir)

    const content = fs.readFileSync(path.join(dir, 'SOUL.md'), 'utf-8')
    expect(content).toContain('# Soul')
    expect(content).toContain('Personality')
  })

  it('AGENTS.md contains memory template', () => {
    const dir = makeTmpDir()
    ensureMemoryStructure(dir)

    const content = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8')
    expect(content).toContain('# Agent Memory')
    expect(content).toContain('Learned Lessons')
  })

  it('does not overwrite existing files', () => {
    const dir = makeTmpDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'SOUL.md'), '# Custom Soul', 'utf-8')

    ensureMemoryStructure(dir)

    const content = fs.readFileSync(path.join(dir, 'SOUL.md'), 'utf-8')
    expect(content).toBe('# Custom Soul')
  })
})
