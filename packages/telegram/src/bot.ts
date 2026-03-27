import { Bot, GrammyError, HttpError } from 'grammy'
import type { Context } from 'grammy'
import type { AgentCore } from '@openagent/core'
import { loadConfig } from '@openagent/core'

/**
 * Telegram config stored in /data/config/telegram.json
 */
export interface TelegramConfig {
  enabled: boolean
  botToken: string
  adminUserIds: number[]
  pollingMode: boolean
  webhookUrl: string
  batchingDelayMs: number
}

export interface TelegramBotOptions {
  agentCore: AgentCore
  config?: TelegramConfig
  onQueueDepthChanged?: (queueDepth: number) => void
}

interface TelegramSettings {
  batchingDelayMs?: number
}

interface QueuedMessage {
  ctx: Context
  text: string
}

interface PendingBatch {
  ctx: Context
  text: string
  timer: ReturnType<typeof setTimeout>
}

interface ChatState {
  pendingBatch: PendingBatch | null
  queue: QueuedMessage[]
  processing: boolean
  abortRequested: boolean
}

/** Telegram's maximum message length */
const MAX_MESSAGE_LENGTH = 4096
const STOP_COMMANDS = new Set(['/stop', '/kill'])

/**
 * Split a long text into chunks that fit within Telegram's message limit.
 * Tries to split at newline boundaries when possible.
 */
function splitMessage(text: string, maxLen: number = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLen) return [text]

  const parts: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      parts.push(remaining)
      break
    }

    // Try to find a good split point (newline) within the limit
    let splitAt = remaining.lastIndexOf('\n', maxLen)
    if (splitAt <= 0 || splitAt < maxLen * 0.5) {
      // No good newline found; try space
      splitAt = remaining.lastIndexOf(' ', maxLen)
    }
    if (splitAt <= 0 || splitAt < maxLen * 0.5) {
      // Hard split at max length
      splitAt = maxLen
    }

    parts.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt).trimStart()
  }

  return parts
}

/**
 * Build user context prefix for the agent
 */
function formatUserContext(ctx: Context): string {
  const from = ctx.from
  if (!from) return ''

  const username = from.username ? `@${from.username}` : null
  const displayName = [from.first_name, from.last_name].filter(Boolean).join(' ')

  if (username && displayName) {
    return `Message from ${username} (${displayName}): `
  } else if (username) {
    return `Message from ${username}: `
  } else if (displayName) {
    return `Message from ${displayName}: `
  }

  return ''
}

/**
 * Get a unique user identifier for session management
 */
function getUserId(ctx: Context): string {
  return `telegram-${ctx.from?.id ?? 'unknown'}`
}

function getChatKey(ctx: Context): string {
  return `telegram-chat-${ctx.chat?.id ?? ctx.from?.id ?? 'unknown'}`
}

function isHandledCommand(text: string): boolean {
  return /^\/(start|new|stop|kill)(?:@[\w_]+)?\b/i.test(text.trim())
}

function normalizeCommand(text: string): string {
  return text.trim().split(/\s+/, 1)[0].toLowerCase().replace(/@[\w_]+$/, '')
}

function loadTelegramRuntimeConfig(): TelegramConfig {
  const telegram = loadConfig<TelegramConfig>('telegram.json')
  let batchingDelayMs = telegram.batchingDelayMs ?? 2500

  try {
    const settings = loadConfig<TelegramSettings>('settings.json')
    if (typeof settings.batchingDelayMs === 'number' && Number.isFinite(settings.batchingDelayMs) && settings.batchingDelayMs >= 0) {
      batchingDelayMs = settings.batchingDelayMs
    }
  } catch {
    // Fall back to telegram.json/defaults when settings are unavailable.
  }

  return {
    ...telegram,
    batchingDelayMs,
  }
}

/**
 * Telegram bot adapter that bridges Telegram messages to Agent Core
 */
export class TelegramBot {
  private bot: Bot
  private agentCore: AgentCore
  private config: TelegramConfig
  private running = false
  private chatStates = new Map<string, ChatState>()
  private onQueueDepthChanged?: (queueDepth: number) => void

  constructor(options: TelegramBotOptions) {
    this.agentCore = options.agentCore
    this.config = options.config ?? loadTelegramRuntimeConfig()
    this.onQueueDepthChanged = options.onQueueDepthChanged

    if (!this.config.botToken) {
      throw new Error(
        'Telegram bot token not configured. Set botToken in /data/config/telegram.json or disable Telegram (enabled: false) for web-only mode.'
      )
    }

    this.bot = new Bot(this.config.botToken)
    this.setupHandlers()
    this.setupErrorHandler()
  }

  private getOrCreateChatState(chatKey: string): ChatState {
    const existing = this.chatStates.get(chatKey)
    if (existing) return existing

    const state: ChatState = {
      pendingBatch: null,
      queue: [],
      processing: false,
      abortRequested: false,
    }

    this.chatStates.set(chatKey, state)
    return state
  }

  private cleanupChatState(chatKey: string): void {
    const state = this.chatStates.get(chatKey)
    if (!state) return

    if (!state.processing && !state.pendingBatch && state.queue.length === 0) {
      this.chatStates.delete(chatKey)
    }
  }

  private emitQueueDepthChanged(): void {
    this.onQueueDepthChanged?.(this.getQueueDepth())
  }

  /**
   * Total queue depth across all chats, including pending batches and active work.
   */
  getQueueDepth(): number {
    let total = 0

    for (const state of this.chatStates.values()) {
      total += state.queue.length
      if (state.pendingBatch) total += 1
      if (state.processing) total += 1
    }

    return total
  }

  /**
   * Set up command and message handlers
   */
  private setupHandlers(): void {
    // /start command - welcome message
    this.bot.command('start', async (ctx) => {
      const welcomeText = [
        '👋 *Welcome to OpenAgent!*',
        '',
        'I\'m your AI assistant. You can chat with me directly or use these commands:',
        '',
        '`/new` — Start a fresh conversation (summarizes & resets current session)',
        '`/start` — Show this welcome message',
        '`/stop` — Abort the current task and clear queued work',
        '',
        'Just send me a message to get started!',
      ].join('\n')

      await ctx.reply(welcomeText, { parse_mode: 'Markdown' })
    })

    // /new command - summarize + reset session
    this.bot.command('new', async (ctx) => {
      const userId = getUserId(ctx)

      try {
        const summary = await this.agentCore.handleNewCommand(userId)

        if (summary) {
          await ctx.reply('📝 Session summarized and saved. Starting fresh conversation!')
        } else {
          await ctx.reply('🔄 Starting fresh conversation!')
        }
      } catch (err) {
        console.error('Error handling /new command:', err)
        await ctx.reply('⚠️ Error resetting session. Please try again.')
      }
    })

    this.bot.command('stop', async (ctx) => {
      await this.handleKillSwitch(ctx)
    })

    this.bot.command('kill', async (ctx) => {
      await this.handleKillSwitch(ctx)
    })

    // Regular text messages
    this.bot.on('message:text', async (ctx) => {
      await this.handleMessage(ctx)
    })
  }

  /**
   * Handle an incoming text message
   */
  private async handleMessage(ctx: Context): Promise<void> {
    const text = ctx.message?.text
    if (!text) return

    const normalizedCommand = normalizeCommand(text)
    if (STOP_COMMANDS.has(normalizedCommand)) {
      await this.handleKillSwitch(ctx)
      return
    }

    if (isHandledCommand(text)) {
      return
    }

    this.bufferMessage(ctx, text)
  }

  private bufferMessage(ctx: Context, text: string): void {
    const chatKey = getChatKey(ctx)
    const state = this.getOrCreateChatState(chatKey)

    if (state.pendingBatch) {
      clearTimeout(state.pendingBatch.timer)
      state.pendingBatch = {
        ctx,
        text: `${state.pendingBatch.text}\n${text}`,
        timer: this.createBatchTimer(chatKey),
      }
    } else {
      state.pendingBatch = {
        ctx,
        text,
        timer: this.createBatchTimer(chatKey),
      }
    }

    this.emitQueueDepthChanged()
  }

  private createBatchTimer(chatKey: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      void this.flushPendingBatch(chatKey)
    }, this.config.batchingDelayMs)
  }

  private async flushPendingBatch(chatKey: string): Promise<void> {
    const state = this.chatStates.get(chatKey)
    if (!state?.pendingBatch) return

    const batch = state.pendingBatch
    state.pendingBatch = null
    state.queue.push({ ctx: batch.ctx, text: batch.text })
    this.emitQueueDepthChanged()

    await this.processQueue(chatKey)
  }

  private async processQueue(chatKey: string): Promise<void> {
    const state = this.chatStates.get(chatKey)
    if (!state || state.processing) return

    state.processing = true
    this.emitQueueDepthChanged()

    try {
      while (state.queue.length > 0) {
        const queuedMessage = state.queue.shift()!
        this.emitQueueDepthChanged()
        await this.processQueuedMessage(chatKey, queuedMessage)
      }
    } finally {
      state.processing = false
      state.abortRequested = false
      this.emitQueueDepthChanged()
      this.cleanupChatState(chatKey)
    }
  }

  private async processQueuedMessage(chatKey: string, queuedMessage: QueuedMessage): Promise<void> {
    const state = this.chatStates.get(chatKey)
    if (!state) return

    const { ctx, text } = queuedMessage
    const userId = getUserId(ctx)
    const messageForAgent = `${formatUserContext(ctx)}${text}`

    try {
      // Send "typing" indicator
      await ctx.replyWithChatAction('typing')

      // Collect the full response from agent
      let fullResponse = ''

      // Set up a typing indicator interval (every 4 seconds)
      const typingInterval = setInterval(async () => {
        try {
          await ctx.replyWithChatAction('typing')
        } catch {
          // Ignore typing indicator errors
        }
      }, 4000)

      try {
        for await (const chunk of this.agentCore.sendMessage(userId, messageForAgent, 'telegram')) {
          if (state.abortRequested) break

          if (chunk.type === 'text' && chunk.text) {
            fullResponse += chunk.text
          }
        }
      } finally {
        clearInterval(typingInterval)
      }

      if (!state.abortRequested && fullResponse.trim()) {
        await this.sendLongMessage(ctx, fullResponse.trim())
      }
    } catch (err) {
      if (state.abortRequested) {
        return
      }

      console.error('Error processing Telegram message:', err)
      await this.safeSendMessage(ctx, '⚠️ Sorry, I encountered an error processing your message. Please try again.')
    }
  }

  private async handleKillSwitch(ctx: Context): Promise<void> {
    const chatKey = getChatKey(ctx)
    const state = this.getOrCreateChatState(chatKey)
    const hadActiveTask = state.processing
    const removedQueuedMessages = state.queue.length + (state.pendingBatch ? 1 : 0)

    if (state.pendingBatch) {
      clearTimeout(state.pendingBatch.timer)
      state.pendingBatch = null
    }

    state.queue = []
    state.abortRequested = hadActiveTask
    this.emitQueueDepthChanged()

    if (hadActiveTask) {
      try {
        this.agentCore.abort()
      } catch (err) {
        console.error('Error aborting Telegram task:', err)
      }
    }

    const confirmation = !hadActiveTask && removedQueuedMessages === 0
      ? 'Nothing to stop.'
      : removedQueuedMessages === 0
        ? 'Task aborted. No queued messages.'
        : `⛔ Aborted. ${removedQueuedMessages} messages removed from queue.`

    await this.safeSendMessage(ctx, confirmation)
    this.cleanupChatState(chatKey)
  }

  /**
   * Send a potentially long message, splitting if necessary
   */
  private async sendLongMessage(ctx: Context, text: string): Promise<void> {
    const parts = splitMessage(text)

    for (const part of parts) {
      await this.safeSendMessage(ctx, part)
    }
  }

  /**
   * Send a message with error handling for Telegram API issues
   */
  private async safeSendMessage(ctx: Context, text: string, retries = 2): Promise<void> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await ctx.reply(text)
        return
      } catch (err) {
        if (err instanceof GrammyError) {
          // Handle rate limiting
          if (err.error_code === 429) {
            const retryAfter = (err.parameters?.retry_after ?? 5) * 1000
            console.warn(`Telegram rate limited. Retrying after ${retryAfter}ms`)
            await sleep(retryAfter)
            continue
          }

          // Other Telegram API errors
          console.error(`Telegram API error (${err.error_code}): ${err.description}`)
        } else if (err instanceof HttpError) {
          console.error('Telegram network error:', err.message)
          if (attempt < retries) {
            await sleep(1000 * (attempt + 1))
            continue
          }
        }

        // If we've exhausted retries or it's a non-retriable error, give up
        if (attempt === retries) {
          console.error('Failed to send Telegram message after retries:', err)
        }
      }
    }
  }

  /**
   * Set up global error handler for the bot
   */
  private setupErrorHandler(): void {
    this.bot.catch((err) => {
      const ctx = err.ctx
      const e = err.error

      console.error(`Error while handling update ${ctx.update.update_id}:`)

      if (e instanceof GrammyError) {
        console.error(`Grammy error (${e.error_code}): ${e.description}`)
      } else if (e instanceof HttpError) {
        console.error('HTTP error:', e.message)
      } else {
        console.error('Unknown error:', e)
      }
    })
  }

  /**
   * Start the bot in polling mode
   */
  async start(): Promise<void> {
    if (this.running) {
      console.warn('Telegram bot is already running')
      return
    }

    try {
      // Verify the bot token by fetching bot info
      const me = await this.bot.api.getMe()
      console.log(`✅ Telegram bot connected: @${me.username} (${me.first_name})`)

      // Start polling
      this.running = true
      this.bot.start({
        onStart: () => {
          console.log('🤖 Telegram bot started in polling mode')
        },
        drop_pending_updates: true,
      })
    } catch (err) {
      this.running = false
      if (err instanceof GrammyError) {
        throw new Error(`Failed to start Telegram bot: ${err.description} (code ${err.error_code})`)
      }
      throw new Error(`Failed to start Telegram bot: ${(err as Error).message}`)
    }
  }

  /**
   * Stop the bot gracefully
   */
  async stop(): Promise<void> {
    if (!this.running) return

    this.running = false
    this.bot.stop()
    console.log('🛑 Telegram bot stopped')
  }

  /**
   * Check if the bot is currently running
   */
  isRunning(): boolean {
    return this.running
  }

  /**
   * Get the underlying grammy Bot instance (for advanced usage)
   */
  getBot(): Bot {
    return this.bot
  }
}

/**
 * Create a Telegram bot if configured, or return null for web-only mode.
 * Does not throw if Telegram is disabled or not configured.
 */
export function createTelegramBot(agentCore: AgentCore): TelegramBot | null {
  try {
    const config = loadTelegramRuntimeConfig()

    if (!config.enabled) {
      console.log('ℹ️  Telegram bot disabled in config (enabled: false). Running in web-only mode.')
      return null
    }

    if (!config.botToken) {
      console.log('ℹ️  No Telegram bot token configured. Running in web-only mode.')
      return null
    }

    return new TelegramBot({ agentCore, config })
  } catch {
    console.log('ℹ️  Telegram config not found. Running in web-only mode.')
    return null
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
