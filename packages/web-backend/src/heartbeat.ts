import type { Database, ProviderConfig, ProviderHealthCheckResult, ProviderHealthStatus, OperatingMode } from '@openagent/core'
import {
  getActiveProvider,
  performProviderHealthCheck,
  logHealthCheck,
  updateProviderStatus,
  ensureConfigTemplates,
  loadConfig,
  ProviderManager,
} from '@openagent/core'

interface TelegramConfig {
  enabled: boolean
  botToken: string
  adminUserIds: number[]
}

interface HeartbeatSettings {
  intervalMinutes: number
  fallbackTrigger: 'down' | 'degraded'
  failuresBeforeFallback: number
  recoveryCheckIntervalMinutes: number
  successesBeforeRecovery: number
  notifications?: {
    healthyToDegraded?: boolean
    degradedToHealthy?: boolean
    degradedToDown?: boolean
    healthyToDown?: boolean
    downToFallback?: boolean
    fallbackToHealthy?: boolean
  }
}

export interface HeartbeatSnapshot {
  agentStatus: 'running' | 'stopped'
  intervalMinutes: number
  operatingMode: OperatingMode
  activeProvider: {
    id: string
    name: string
    type: string
    model: string
    status: ProviderHealthStatus
  } | null
  primaryProvider: {
    id: string
    name: string
    type: string
    model: string
    lastHealthStatus: ProviderHealthStatus | null
  } | null
  fallbackProvider: {
    id: string
    name: string
    type: string
    model: string
  } | null
  lastCheck: ProviderHealthCheckResult | null
}

export interface HeartbeatServiceOptions {
  db: Database
  providerManager?: ProviderManager | null
  fetchImpl?: typeof fetch
  now?: () => Date
}

export class HeartbeatService {
  private db: Database
  private providerManager: ProviderManager | null
  private fetchImpl: typeof fetch
  private now: () => Date
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private settings: HeartbeatSettings
  private lastCheck: ProviderHealthCheckResult | null = null
  private activeProviderId: string | null = null
  private checkInFlight: Promise<ProviderHealthCheckResult> | null = null
  private primaryLastHealthStatus: ProviderHealthStatus | null = null

  constructor(options: HeartbeatServiceOptions) {
    this.db = options.db
    this.providerManager = options.providerManager ?? null
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? (() => new Date())
    this.settings = this.loadHeartbeatSettings()
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.settings = this.loadHeartbeatSettings()
    this.scheduleNext(0)
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  restart(options: { resetState?: boolean } = {}): void {
    if (options.resetState) {
      this.lastCheck = null
      this.activeProviderId = null
      this.primaryLastHealthStatus = null
      if (this.providerManager) {
        this.providerManager.reset()
      }
    }

    this.settings = this.loadHeartbeatSettings()

    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    if (this.running) {
      this.scheduleNext(0)
    }
  }

  async runNow(): Promise<ProviderHealthCheckResult> {
    if (this.checkInFlight) {
      return this.checkInFlight
    }

    this.checkInFlight = this.executeCheck().finally(() => {
      this.checkInFlight = null
      if (this.running) {
        const intervalMs = this.getCurrentIntervalMs()
        this.scheduleNext(intervalMs)
      }
    })

    return this.checkInFlight
  }

  getSnapshot(): HeartbeatSnapshot {
    const mode = this.providerManager?.getOperatingMode() ?? 'normal'
    const provider = getActiveProvider()

    // Build primary provider info
    let primaryProvider: HeartbeatSnapshot['primaryProvider'] = null
    const primary = this.providerManager?.getPrimaryProvider()
    if (primary) {
      primaryProvider = {
        id: primary.id,
        name: primary.name,
        type: primary.providerType,
        model: primary.defaultModel,
        lastHealthStatus: this.primaryLastHealthStatus,
      }
    }

    // Build fallback provider info
    let fallbackProvider: HeartbeatSnapshot['fallbackProvider'] = null
    const fallback = this.providerManager?.getFallbackProvider()
    if (fallback) {
      fallbackProvider = {
        id: fallback.id,
        name: fallback.name,
        type: fallback.providerType,
        model: fallback.defaultModel,
      }
    }

    return {
      agentStatus: this.running ? 'running' : 'stopped',
      intervalMinutes: this.settings.intervalMinutes,
      operatingMode: mode,
      activeProvider: provider
        ? {
            id: provider.id,
            name: provider.name,
            type: provider.providerType,
            model: provider.defaultModel,
            status: this.lastCheck?.providerId === provider.id
              ? this.lastCheck.status
              : 'unconfigured',
          }
        : null,
      primaryProvider,
      fallbackProvider,
      lastCheck: this.lastCheck,
    }
  }

  private getCurrentIntervalMs(): number {
    const mode = this.providerManager?.getOperatingMode() ?? 'normal'
    if (mode === 'fallback') {
      return this.settings.recoveryCheckIntervalMinutes * 60 * 1000
    }
    return this.settings.intervalMinutes * 60 * 1000
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return

    if (this.timer) {
      clearTimeout(this.timer)
    }

    this.timer = setTimeout(() => {
      void this.runNow()
    }, Math.max(0, delayMs))

    if (typeof this.timer === 'object' && 'unref' in this.timer) {
      this.timer.unref()
    }
  }

  private async executeCheck(): Promise<ProviderHealthCheckResult> {
    const mode = this.providerManager?.getOperatingMode() ?? 'normal'

    // In fallback mode, check the PRIMARY provider for recovery
    if (mode === 'fallback' && this.providerManager) {
      return this.executeRecoveryCheck()
    }

    // Normal mode: check active provider
    return this.executeNormalCheck()
  }

  private async executeNormalCheck(): Promise<ProviderHealthCheckResult> {
    const provider = getActiveProvider()

    if (provider?.id !== this.activeProviderId) {
      this.activeProviderId = provider?.id ?? null
      this.lastCheck = null
    }

    const previousStatus = this.lastCheck?.status ?? null
    const result = await performProviderHealthCheck(provider, {
      fetchImpl: this.fetchImpl,
    })

    result.checkedAt = this.now().toISOString()

    logHealthCheck(this.db, {
      timestamp: result.checkedAt,
      provider: result.providerName,
      status: result.status,
      latencyMs: result.latencyMs,
      errorMessage: result.errorMessage,
    })

    if (provider) {
      updateProviderStatus(provider.id, result.status === 'down' ? 'error' : 'connected')
    }

    // Track primary health status in normal mode
    if (provider) {
      this.primaryLastHealthStatus = result.status
    }

    this.lastCheck = result

    // Count failures and trigger fallback if threshold reached
    if (this.providerManager && provider) {
      const isFailure = this.isFailureStatus(result.status)
      if (isFailure) {
        this.providerManager.incrementFailures()
        if (this.providerManager.getConsecutiveFailures() >= this.settings.failuresBeforeFallback) {
          this.providerManager.swapToFallback()
          // Reset counters after mode change
          this.providerManager.resetCounters()
        }
      } else {
        // Reset failure counter on success
        this.providerManager.resetCounters()
      }
    }

    // Send notifications based on status transition
    const shouldNotifyDown = result.status === 'down' && previousStatus !== 'down'
    const shouldNotifyRecovery = previousStatus === 'down' && result.status === 'healthy'

    if (shouldNotifyDown) {
      await this.sendTelegramAlert('down', provider, result)
    } else if (shouldNotifyRecovery) {
      await this.sendTelegramAlert('recovery', provider, result)
    }

    return result
  }

  private async executeRecoveryCheck(): Promise<ProviderHealthCheckResult> {
    const primary = this.providerManager!.getPrimaryProvider()

    const previousStatus = this.lastCheck?.status ?? null
    const result = await performProviderHealthCheck(primary, {
      fetchImpl: this.fetchImpl,
    })

    result.checkedAt = this.now().toISOString()

    logHealthCheck(this.db, {
      timestamp: result.checkedAt,
      provider: result.providerName,
      status: result.status,
      latencyMs: result.latencyMs,
      errorMessage: result.errorMessage,
    })

    if (primary) {
      updateProviderStatus(primary.id, result.status === 'down' ? 'error' : 'connected')
    }

    // Track primary health status
    this.primaryLastHealthStatus = result.status

    this.lastCheck = result

    // Count consecutive successes for recovery
    if (result.status === 'healthy') {
      this.providerManager!.incrementSuccesses()
      if (this.providerManager!.getConsecutiveSuccesses() >= this.settings.successesBeforeRecovery) {
        this.providerManager!.swapToPrimary()
        // Reset counters after mode change
        this.providerManager!.resetCounters()
      }
    } else {
      // Reset success counter on any non-healthy check
      this.providerManager!.resetCounters()
    }

    // Notifications for recovery checks
    const shouldNotifyDown = result.status === 'down' && previousStatus !== 'down'
    const shouldNotifyRecovery = previousStatus === 'down' && result.status === 'healthy'

    if (shouldNotifyDown) {
      await this.sendTelegramAlert('down', primary, result)
    } else if (shouldNotifyRecovery) {
      await this.sendTelegramAlert('recovery', primary, result)
    }

    return result
  }

  private isFailureStatus(status: ProviderHealthStatus): boolean {
    if (status === 'down') return true
    if (this.settings.fallbackTrigger === 'degraded' && status === 'degraded') return true
    return false
  }

  private loadHeartbeatSettings(): HeartbeatSettings {
    try {
      ensureConfigTemplates()
      const settings = loadConfig<{
        heartbeat?: Partial<HeartbeatSettings>
        heartbeatIntervalMinutes?: number
      }>('settings.json')

      const heartbeat = settings.heartbeat

      if (heartbeat) {
        const intervalMinutes = heartbeat.intervalMinutes ?? 5
        return {
          intervalMinutes: Number.isFinite(intervalMinutes) && intervalMinutes >= 1 ? intervalMinutes : 5,
          fallbackTrigger: heartbeat.fallbackTrigger === 'degraded' ? 'degraded' : 'down',
          failuresBeforeFallback: this.safePositiveInt(heartbeat.failuresBeforeFallback, 1),
          recoveryCheckIntervalMinutes: this.safePositiveNumber(heartbeat.recoveryCheckIntervalMinutes, 1),
          successesBeforeRecovery: this.safePositiveInt(heartbeat.successesBeforeRecovery, 3),
          notifications: heartbeat.notifications,
        }
      }

      // Legacy fallback: read top-level heartbeatIntervalMinutes
      const legacyInterval = settings.heartbeatIntervalMinutes ?? 5
      return {
        intervalMinutes: Number.isFinite(legacyInterval) && legacyInterval >= 1 ? legacyInterval : 5,
        fallbackTrigger: 'down',
        failuresBeforeFallback: 1,
        recoveryCheckIntervalMinutes: 1,
        successesBeforeRecovery: 3,
      }
    } catch {
      return {
        intervalMinutes: 5,
        fallbackTrigger: 'down',
        failuresBeforeFallback: 1,
        recoveryCheckIntervalMinutes: 1,
        successesBeforeRecovery: 3,
      }
    }
  }

  private safePositiveInt(value: number | undefined, defaultValue: number): number {
    if (value === undefined) return defaultValue
    return Number.isFinite(value) && Number.isInteger(value) && value >= 1 ? value : defaultValue
  }

  private safePositiveNumber(value: number | undefined, defaultValue: number): number {
    if (value === undefined) return defaultValue
    return Number.isFinite(value) && value >= 0.1 ? value : defaultValue
  }

  private loadTelegramConfig(): TelegramConfig | null {
    try {
      ensureConfigTemplates()
      const config = loadConfig<TelegramConfig>('telegram.json')
      return config
    } catch {
      return null
    }
  }

  private getAdminTelegramIds(): number[] {
    const config = this.loadTelegramConfig()
    const configuredIds = config?.adminUserIds ?? []
    const dbIds = (this.db.prepare(
      `SELECT telegram_id
       FROM users
       WHERE role = 'admin' AND telegram_id IS NOT NULL AND trim(telegram_id) != ''`
    ).all() as Array<{ telegram_id: string }>).map((row) => Number.parseInt(row.telegram_id, 10))

    return Array.from(new Set([...configuredIds, ...dbIds].filter((id) => Number.isFinite(id))))
  }

  private async sendTelegramAlert(
    kind: 'down' | 'recovery',
    provider: ProviderConfig | null,
    result: ProviderHealthCheckResult,
  ): Promise<void> {
    const telegram = this.loadTelegramConfig()
    if (!telegram?.enabled || !telegram.botToken) {
      return
    }

    const adminIds = this.getAdminTelegramIds()
    if (adminIds.length === 0) {
      return
    }

    const title = kind === 'down' ? '🚨 OpenAgent provider is down' : '✅ OpenAgent provider recovered'
    const lines = [
      title,
      `Provider: ${provider?.name ?? 'Not configured'}`,
      `Model: ${provider?.defaultModel ?? '—'}`,
      `Status: ${result.status}`,
      `Checked at: ${result.checkedAt}`,
    ]

    if (result.latencyMs !== null) {
      lines.push(`Latency: ${result.latencyMs}ms`)
    }

    if (result.errorMessage) {
      lines.push(`Error: ${result.errorMessage}`)
    }

    const text = lines.join('\n')

    await Promise.all(adminIds.map(async (chatId) => {
      try {
        const response = await this.fetchImpl(`https://api.telegram.org/bot${telegram.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text }),
        })

        if (!response.ok) {
          const body = await response.text().catch(() => '')
          console.error(`[openagent] Failed to send Telegram heartbeat alert to ${chatId}: ${response.status} ${body}`)
        }
      } catch (err) {
        console.error(`[openagent] Failed to send Telegram heartbeat alert to ${chatId}:`, err)
      }
    }))
  }
}
