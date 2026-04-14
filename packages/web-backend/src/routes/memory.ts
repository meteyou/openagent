import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import {
  getMemoryDir,
  ensureMemoryStructure,
  readSoulFile,
  readMemoryFile,
  writeMemoryFile,
  readAgentsRulesFile,
  writeAgentsRulesFile,
  getDefaultAgentsRulesContent,
  readHeartbeatFile,
  writeHeartbeatFile,
  getDefaultHeartbeatContent,
  readConsolidationFile,
  writeConsolidationFile,
  getDefaultConsolidationContent,
  readUserProfile,
  ensureUserProfile,
  listMemories,
  updateMemory,
  deleteMemory,
} from '@openagent/core'
import type { AgentCore, Database } from '@openagent/core'
import { jwtMiddleware } from '../auth.js'
import type { AuthenticatedRequest } from '../auth.js'
import type { MemoryConsolidationScheduler } from '../memory-consolidation-scheduler.js'

export function createMemoryRouter(db: Database, getAgentCore: () => AgentCore | null = () => null, consolidationScheduler?: MemoryConsolidationScheduler | null): Router {
  const router = Router()

  router.use(jwtMiddleware)
  router.use((req: AuthenticatedRequest, res, next) => {
    if (req.user?.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required' })
      return
    }
    next()
  })

  function refreshAgentPrompt(): void {
    const agentCore = getAgentCore()
    if (!agentCore) return

    try {
      agentCore.refreshSystemPrompt()
    } catch (err) {
      console.error('[openagent] Failed to refresh system prompt after memory update:', err)
    }
  }

  router.get('/soul', (_req, res) => {
    try {
      const content = readSoulFile()
      res.json({ content })
    } catch (err) {
      res.status(500).json({ error: `Failed to read SOUL.md: ${(err as Error).message}` })
    }
  })

  router.put('/soul', (req: AuthenticatedRequest, res) => {
    const { content } = req.body as { content?: string }
    if (content === undefined || content === null) {
      res.status(400).json({ error: 'Content is required' })
      return
    }

    try {
      const memoryDir = getMemoryDir()
      ensureMemoryStructure(memoryDir)
      const soulPath = path.join(memoryDir, 'SOUL.md')
      fs.writeFileSync(soulPath, content, 'utf-8')
      refreshAgentPrompt()
      res.json({ message: 'SOUL.md updated', content })
    } catch (err) {
      res.status(500).json({ error: `Failed to write SOUL.md: ${(err as Error).message}` })
    }
  })

  // Core memory endpoints (MEMORY.md)
  // Support both /memory (new) and /agents (legacy) paths
  router.get('/core', (_req, res) => {
    try {
      const content = readMemoryFile()
      res.json({ content })
    } catch (err) {
      res.status(500).json({ error: `Failed to read MEMORY.md: ${(err as Error).message}` })
    }
  })

  router.put('/core', (req: AuthenticatedRequest, res) => {
    const { content } = req.body as { content?: string }
    if (content === undefined || content === null) {
      res.status(400).json({ error: 'Content is required' })
      return
    }

    try {
      writeMemoryFile(content)
      refreshAgentPrompt()
      res.json({ message: 'MEMORY.md updated', content })
    } catch (err) {
      res.status(500).json({ error: `Failed to write MEMORY.md: ${(err as Error).message}` })
    }
  })

  // Agent rules endpoints (AGENTS.md)
  router.get('/agents', (_req, res) => {
    try {
      const content = readAgentsRulesFile()
      res.json({ content })
    } catch (err) {
      res.status(500).json({ error: `Failed to read AGENTS.md: ${(err as Error).message}` })
    }
  })

  router.put('/agents', (req: AuthenticatedRequest, res) => {
    const { content } = req.body as { content?: string }
    if (content === undefined || content === null) {
      res.status(400).json({ error: 'Content is required' })
      return
    }

    try {
      writeAgentsRulesFile(content)
      refreshAgentPrompt()
      res.json({ message: 'AGENTS.md updated', content })
    } catch (err) {
      res.status(500).json({ error: `Failed to write AGENTS.md: ${(err as Error).message}` })
    }
  })

  router.get('/agents/default', (_req, res) => {
    try {
      res.json({ content: getDefaultAgentsRulesContent() })
    } catch (err) {
      res.status(500).json({ error: `Failed to load AGENTS.md default: ${(err as Error).message}` })
    }
  })

  router.get('/daily', (_req, res) => {
    try {
      const memoryDir = getMemoryDir()
      const dailyDir = path.join(memoryDir, 'daily')
      ensureMemoryStructure(memoryDir)

      if (!fs.existsSync(dailyDir)) {
        res.json({ files: [] })
        return
      }

      const entries = fs.readdirSync(dailyDir)
        .filter(f => f.endsWith('.md'))
        .sort()
        .reverse()

      const files = entries.map(filename => {
        const filePath = path.join(dailyDir, filename)
        const stats = fs.statSync(filePath)
        const date = filename.replace('.md', '')
        return {
          filename,
          date,
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
        }
      })

      res.json({ files })
    } catch (err) {
      res.status(500).json({ error: `Failed to list daily files: ${(err as Error).message}` })
    }
  })

  router.get('/daily/:date', (req, res) => {
    const { date } = req.params
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' })
      return
    }

    try {
      const memoryDir = getMemoryDir()
      const filePath = path.join(memoryDir, 'daily', `${date}.md`)

      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: `Daily file for ${date} not found` })
        return
      }

      const content = fs.readFileSync(filePath, 'utf-8')
      res.json({ date, content })
    } catch (err) {
      res.status(500).json({ error: `Failed to read daily file: ${(err as Error).message}` })
    }
  })

  router.put('/daily/:date', (req: AuthenticatedRequest, res) => {
    const rawDate = req.params.date
    const date = Array.isArray(rawDate) ? rawDate[0] : rawDate
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' })
      return
    }

    const { content } = req.body as { content?: string }
    if (content === undefined || content === null) {
      res.status(400).json({ error: 'Content is required' })
      return
    }

    try {
      const memoryDir = getMemoryDir()
      const dailyDir = path.join(memoryDir, 'daily')
      ensureMemoryStructure(memoryDir)

      if (!fs.existsSync(dailyDir)) {
        fs.mkdirSync(dailyDir, { recursive: true })
      }

      const filePath = path.join(dailyDir, `${date}.md`)
      fs.writeFileSync(filePath, content, 'utf-8')
      refreshAgentPrompt()
      res.json({ message: `Daily file for ${date} updated`, date, content })
    } catch (err) {
      res.status(500).json({ error: `Failed to write daily file: ${(err as Error).message}` })
    }
  })

  // Wiki page endpoints (/data/memory/wiki/*.md)
  // Also keep /projects/* as legacy aliases for backward compatibility
  router.get('/wiki', (_req, res) => {
    try {
      const memoryDir = getMemoryDir()
      const wikiDir = path.join(memoryDir, 'wiki')
      ensureMemoryStructure(memoryDir)

      if (!fs.existsSync(wikiDir)) {
        res.json({ files: [] })
        return
      }

      const entries = fs.readdirSync(wikiDir)
        .filter(f => f.endsWith('.md'))
        .sort()

      const files = entries.map(filename => {
        const filePath = path.join(wikiDir, filename)
        const stats = fs.statSync(filePath)
        const name = filename.replace('.md', '')
        const content = fs.readFileSync(filePath, 'utf-8')
        // Extract title from first heading
        const titleMatch = content.match(/^#\s+(.+)$/m)
        const title = titleMatch ? titleMatch[1].trim() : name
        // Extract aliases from frontmatter
        const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
        const aliases: string[] = []
        if (fmMatch) {
          const aliasMatch = fmMatch[1].match(/^aliases:\s*\[([^\]]*)\]/m)
          if (aliasMatch) {
            aliases.push(...aliasMatch[1].split(',').map(s => s.trim()).filter(s => s.length > 0))
          } else {
            const singleMatch = fmMatch[1].match(/^aliases:\s*(.+)$/m)
            if (singleMatch && singleMatch[1].trim()) aliases.push(singleMatch[1].trim())
          }
        }
        return {
          filename,
          name,
          title,
          aliases,
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
        }
      })

      res.json({ files })
    } catch (err) {
      res.status(500).json({ error: `Failed to list wiki pages: ${(err as Error).message}` })
    }
  })

  router.get('/wiki/:filename', (req, res) => {
    const { filename } = req.params
    if (!/^[\w.-]+$/.test(filename)) {
      res.status(400).json({ error: 'Invalid filename. Use only alphanumeric characters, hyphens, underscores, and dots.' })
      return
    }
    // Allow both "name" and "name.md"
    const name = filename.endsWith('.md') ? filename.slice(0, -3) : filename
    const safeFilename = `${name}.md`

    try {
      const memoryDir = getMemoryDir()
      const filePath = path.join(memoryDir, 'wiki', safeFilename)

      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: `Wiki page "${name}" not found` })
        return
      }

      const content = fs.readFileSync(filePath, 'utf-8')
      res.json({ name, content })
    } catch (err) {
      res.status(500).json({ error: `Failed to read wiki page: ${(err as Error).message}` })
    }
  })

  router.put('/wiki/:filename', (req: AuthenticatedRequest, res) => {
    const rawFilename = req.params.filename
    const filename = Array.isArray(rawFilename) ? rawFilename[0] : rawFilename
    if (!filename || !/^[\w.-]+$/.test(filename)) {
      res.status(400).json({ error: 'Invalid filename. Use only alphanumeric characters, hyphens, underscores, and dots.' })
      return
    }
    const name = filename.endsWith('.md') ? filename.slice(0, -3) : filename
    const safeFilename = `${name}.md`

    const { content } = req.body as { content?: string }
    if (content === undefined || content === null) {
      res.status(400).json({ error: 'Content is required' })
      return
    }

    try {
      const memoryDir = getMemoryDir()
      const wikiDir = path.join(memoryDir, 'wiki')
      ensureMemoryStructure(memoryDir)

      if (!fs.existsSync(wikiDir)) {
        fs.mkdirSync(wikiDir, { recursive: true })
      }

      const filePath = path.join(wikiDir, safeFilename)
      fs.writeFileSync(filePath, content, 'utf-8')
      refreshAgentPrompt()
      res.json({ message: `Wiki page "${name}" updated`, name, content })
    } catch (err) {
      res.status(500).json({ error: `Failed to write wiki page: ${(err as Error).message}` })
    }
  })

  router.delete('/wiki/:filename', (req: AuthenticatedRequest, res) => {
    const rawFilename = req.params.filename
    const filename = Array.isArray(rawFilename) ? rawFilename[0] : rawFilename
    if (!filename || !/^[\w.-]+$/.test(filename)) {
      res.status(400).json({ error: 'Invalid filename.' })
      return
    }
    const name = filename.endsWith('.md') ? filename.slice(0, -3) : filename
    const safeFilename = `${name}.md`

    try {
      const memoryDir = getMemoryDir()
      const filePath = path.join(memoryDir, 'wiki', safeFilename)

      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: `Wiki page "${name}" not found` })
        return
      }

      fs.unlinkSync(filePath)
      refreshAgentPrompt()
      res.json({ message: `Wiki page "${name}" deleted`, name })
    } catch (err) {
      res.status(500).json({ error: `Failed to delete wiki page: ${(err as Error).message}` })
    }
  })

  // Legacy /projects/* aliases for backward compatibility
  router.get('/projects', (_req, res) => {
    try {
      const memoryDir = getMemoryDir()
      const wikiDir = path.join(memoryDir, 'wiki')
      ensureMemoryStructure(memoryDir)

      if (!fs.existsSync(wikiDir)) {
        res.json({ files: [] })
        return
      }

      const entries = fs.readdirSync(wikiDir)
        .filter(f => f.endsWith('.md'))
        .sort()

      const files = entries.map(filename => {
        const filePath = path.join(wikiDir, filename)
        const stats = fs.statSync(filePath)
        const name = filename.replace('.md', '')
        return { filename, name, size: stats.size, modifiedAt: stats.mtime.toISOString() }
      })

      res.json({ files })
    } catch (err) {
      res.status(500).json({ error: `Failed to list project files: ${(err as Error).message}` })
    }
  })

  router.get('/projects/:name', (req, res) => {
    const { name } = req.params
    if (!/^[\w-]+$/.test(name)) {
      res.status(400).json({ error: 'Invalid project name. Use only alphanumeric characters, hyphens, and underscores.' })
      return
    }

    try {
      const memoryDir = getMemoryDir()
      const filePath = path.join(memoryDir, 'wiki', `${name}.md`)

      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: `Project file "${name}" not found` })
        return
      }

      const content = fs.readFileSync(filePath, 'utf-8')
      res.json({ name, content })
    } catch (err) {
      res.status(500).json({ error: `Failed to read project file: ${(err as Error).message}` })
    }
  })

  router.put('/projects/:name', (req: AuthenticatedRequest, res) => {
    const rawName = req.params.name
    const name = Array.isArray(rawName) ? rawName[0] : rawName
    if (!name || !/^[\w-]+$/.test(name)) {
      res.status(400).json({ error: 'Invalid project name. Use only alphanumeric characters, hyphens, and underscores.' })
      return
    }

    const { content } = req.body as { content?: string }
    if (content === undefined || content === null) {
      res.status(400).json({ error: 'Content is required' })
      return
    }

    try {
      const memoryDir = getMemoryDir()
      const wikiDir = path.join(memoryDir, 'wiki')
      ensureMemoryStructure(memoryDir)

      if (!fs.existsSync(wikiDir)) {
        fs.mkdirSync(wikiDir, { recursive: true })
      }

      const filePath = path.join(wikiDir, `${name}.md`)
      fs.writeFileSync(filePath, content, 'utf-8')
      refreshAgentPrompt()
      res.json({ message: `Project file "${name}" updated`, name, content })
    } catch (err) {
      res.status(500).json({ error: `Failed to write project file: ${(err as Error).message}` })
    }
  })

  // Heartbeat endpoints (HEARTBEAT.md — agent heartbeat task list)
  router.get('/heartbeat', (_req, res) => {
    try {
      const content = readHeartbeatFile()
      res.json({ content })
    } catch (err) {
      res.status(500).json({ error: `Failed to read HEARTBEAT.md: ${(err as Error).message}` })
    }
  })

  router.put('/heartbeat', (req: AuthenticatedRequest, res) => {
    const { content } = req.body as { content?: string }
    if (content === undefined || content === null) {
      res.status(400).json({ error: 'Content is required' })
      return
    }

    try {
      writeHeartbeatFile(content)
      refreshAgentPrompt()
      res.json({ message: 'HEARTBEAT.md updated', content })
    } catch (err) {
      res.status(500).json({ error: `Failed to write HEARTBEAT.md: ${(err as Error).message}` })
    }
  })

  router.get('/heartbeat/default', (_req, res) => {
    try {
      res.json({ content: getDefaultHeartbeatContent() })
    } catch (err) {
      res.status(500).json({ error: `Failed to load HEARTBEAT.md default: ${(err as Error).message}` })
    }
  })

  // User profile endpoints
  router.get('/profile', (req: AuthenticatedRequest, res) => {
    try {
      const username = req.user?.username
      if (!username) {
        res.status(400).json({ error: 'Username not available from auth' })
        return
      }
      const content = readUserProfile(username)
      res.json({ username, content })
    } catch (err) {
      res.status(500).json({ error: `Failed to read user profile: ${(err as Error).message}` })
    }
  })

  router.put('/profile', (req: AuthenticatedRequest, res) => {
    const username = req.user?.username
    if (!username) {
      res.status(400).json({ error: 'Username not available from auth' })
      return
    }

    const { content } = req.body as { content?: string }
    if (content === undefined || content === null) {
      res.status(400).json({ error: 'Content is required' })
      return
    }

    try {
      const profilePath = ensureUserProfile(username)
      fs.writeFileSync(profilePath, content, 'utf-8')
      refreshAgentPrompt()
      res.json({ message: `Profile for ${username} updated`, username, content })
    } catch (err) {
      res.status(500).json({ error: `Failed to write user profile: ${(err as Error).message}` })
    }
  })

  router.get('/facts', (req, res) => {
    const rawUserId = req.query.userId
    const rawLimit = req.query.limit
    const rawOffset = req.query.offset

    const userId = typeof rawUserId === 'string' && rawUserId.trim().length > 0
      ? Number.parseInt(rawUserId, 10)
      : undefined
    const limit = typeof rawLimit === 'string' && rawLimit.trim().length > 0
      ? Number.parseInt(rawLimit, 10)
      : undefined
    const offset = typeof rawOffset === 'string' && rawOffset.trim().length > 0
      ? Number.parseInt(rawOffset, 10)
      : undefined

    if (userId !== undefined && Number.isNaN(userId)) {
      res.status(400).json({ error: 'Invalid userId' })
      return
    }

    if (limit !== undefined && Number.isNaN(limit)) {
      res.status(400).json({ error: 'Invalid limit' })
      return
    }

    if (offset !== undefined && Number.isNaN(offset)) {
      res.status(400).json({ error: 'Invalid offset' })
      return
    }

    try {
      const result = listMemories(db, {
        query: typeof req.query.query === 'string' ? req.query.query : undefined,
        userId,
        dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
        dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
        limit,
        offset,
      })

      res.json(result)
    } catch (err) {
      const message = (err as Error).message
      const status = message.startsWith('Invalid date') ? 400 : 500
      res.status(status).json({ error: `Failed to list facts: ${message}` })
    }
  })

  router.put('/facts/:id', (req: AuthenticatedRequest, res) => {
    const rawId = req.params.id
    const id = Number.parseInt(Array.isArray(rawId) ? rawId[0] : rawId, 10)
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid fact ID' })
      return
    }

    const { content } = req.body as { content?: string }
    const trimmedContent = content?.trim()
    if (!trimmedContent) {
      res.status(400).json({ error: 'Content is required' })
      return
    }

    try {
      updateMemory(db, id, trimmedContent)
      res.json({ message: 'Fact updated' })
    } catch (err) {
      const message = (err as Error).message
      const status = message.startsWith('Memory not found') ? 404 : 500
      res.status(status).json({ error: status === 404 ? 'Fact not found' : `Failed to update fact: ${message}` })
    }
  })

  router.delete('/facts/:id', (req: AuthenticatedRequest, res) => {
    const rawId = req.params.id
    const id = Number.parseInt(Array.isArray(rawId) ? rawId[0] : rawId, 10)
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid fact ID' })
      return
    }

    try {
      deleteMemory(db, id)
      res.json({ message: 'Fact deleted' })
    } catch (err) {
      const message = (err as Error).message
      const status = message.startsWith('Memory not found') ? 404 : 500
      res.status(status).json({ error: status === 404 ? 'Fact not found' : `Failed to delete fact: ${message}` })
    }
  })

  // Consolidation rules endpoints (CONSOLIDATION.md)
  router.get('/consolidation-rules', (_req, res) => {
    try {
      const content = readConsolidationFile()
      res.json({ content })
    } catch (err) {
      res.status(500).json({ error: `Failed to read CONSOLIDATION.md: ${(err as Error).message}` })
    }
  })

  router.put('/consolidation-rules', (req: AuthenticatedRequest, res) => {
    const { content } = req.body as { content?: string }
    if (content === undefined || content === null) {
      res.status(400).json({ error: 'Content is required' })
      return
    }

    try {
      writeConsolidationFile(content)
      res.json({ message: 'CONSOLIDATION.md updated', content })
    } catch (err) {
      res.status(500).json({ error: `Failed to write CONSOLIDATION.md: ${(err as Error).message}` })
    }
  })

  router.get('/consolidation-rules/default', (_req, res) => {
    try {
      res.json({ content: getDefaultConsolidationContent() })
    } catch (err) {
      res.status(500).json({ error: `Failed to load CONSOLIDATION.md default: ${(err as Error).message}` })
    }
  })

  // Consolidation endpoints
  router.get('/consolidation/status', (_req, res) => {
    if (!consolidationScheduler) {
      res.json({
        enabled: false,
        runAtHour: 3,
        lookbackDays: 3,
        providerId: '',
        lastRun: null,
        lastResult: null,
        nextRunEstimate: null,
      })
      return
    }

    res.json(consolidationScheduler.getSnapshot())
  })

  router.post('/consolidation/run', async (_req, res) => {
    if (!consolidationScheduler) {
      res.status(503).json({ error: 'Consolidation scheduler not available' })
      return
    }

    try {
      const result = await consolidationScheduler.runNow()
      refreshAgentPrompt()
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: `Consolidation failed: ${(err as Error).message}` })
    }
  })

  return router
}
