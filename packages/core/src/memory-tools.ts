import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@mariozechner/pi-ai'
import { readMemoryFile, writeMemoryFile, readDailyFile, appendToDailyFile } from './memory.js'

/**
 * Create agent tools for interacting with the memory system
 */
export function createMemoryTools(memoryDir?: string): AgentTool[] {
  const readCoreMemoryTool: AgentTool = {
    name: 'read_core_memory',
    label: 'Read Core Memory',
    description: 'Read the MEMORY.md core memory file. This contains long-term knowledge: user preferences, important links/repos, learned lessons, technical instructions, and anything the user wants remembered permanently across sessions.',
    parameters: Type.Object({}),
    execute: async () => {
      try {
        const content = readMemoryFile(memoryDir)
        return {
          content: [{ type: 'text' as const, text: content }],
          details: { success: true },
        }
      } catch (err: unknown) {
        return {
          content: [{ type: 'text' as const, text: `Error reading core memory: ${(err as Error).message}` }],
          details: { error: true },
        }
      }
    },
  }

  const writeCoreMemoryTool: AgentTool = {
    name: 'write_core_memory',
    label: 'Write Core Memory',
    description: 'Overwrite the MEMORY.md core memory file. Use this when the user asks you to remember/save something permanently (e.g. links, repos, preferences, names, rules, lessons). Read the file first, then write back the updated version. Be careful: this replaces the entire file.',
    parameters: Type.Object({
      content: Type.String({ description: 'The full new content for the MEMORY.md file' }),
    }),
    execute: async (_toolCallId, params) => {
      const { content } = params as { content: string }
      try {
        writeMemoryFile(content, memoryDir)
        return {
          content: [{ type: 'text' as const, text: `Successfully updated core memory (${content.length} bytes)` }],
          details: { success: true, size: content.length },
        }
      } catch (err: unknown) {
        return {
          content: [{ type: 'text' as const, text: `Error writing core memory: ${(err as Error).message}` }],
          details: { error: true },
        }
      }
    },
  }

  const readDailyMemoryTool: AgentTool = {
    name: 'read_daily_memory',
    label: 'Read Daily Memory',
    description: 'Read the daily memory file for a specific date (defaults to today). Contains automatic session summaries and logs for that day. This is NOT for user-requested memories — those go in core memory.',
    parameters: Type.Object({
      date: Type.Optional(Type.String({ description: 'Date in YYYY-MM-DD format (defaults to today)' })),
    }),
    execute: async (_toolCallId, params) => {
      const { date: dateStr } = params as { date?: string }
      try {
        const date = dateStr ? new Date(dateStr + 'T12:00:00Z') : undefined
        const content = readDailyFile(date, memoryDir)
        return {
          content: [{ type: 'text' as const, text: content }],
          details: { success: true },
        }
      } catch (err: unknown) {
        return {
          content: [{ type: 'text' as const, text: `Error reading daily memory: ${(err as Error).message}` }],
          details: { error: true },
        }
      }
    },
  }

  const appendDailyMemoryTool: AgentTool = {
    name: 'append_daily_memory',
    label: 'Append to Daily Memory',
    description: 'Append a brief log entry to today\'s daily memory file. Use ONLY for automatic session logging (e.g. summarizing what was done today). Do NOT use this when the user asks you to "remember" or "save" something — use write_core_memory for that instead. The date is always today (server-side).',
    parameters: Type.Object({
      content: Type.String({ description: 'Content to append to today\'s daily memory file' }),
    }),
    execute: async (_toolCallId, params) => {
      const { content } = params as { content: string }
      try {
        appendToDailyFile(content, undefined, memoryDir)
        return {
          content: [{ type: 'text' as const, text: `Successfully appended ${content.length} bytes to daily memory` }],
          details: { success: true, size: content.length },
        }
      } catch (err: unknown) {
        return {
          content: [{ type: 'text' as const, text: `Error appending to daily memory: ${(err as Error).message}` }],
          details: { error: true },
        }
      }
    },
  }

  return [readCoreMemoryTool, writeCoreMemoryTool, readDailyMemoryTool, appendDailyMemoryTool]
}
