export const HEALTH_MONITOR_FALLBACK_TRIGGERS = ['down', 'degraded'] as const
export type HealthMonitorFallbackTrigger = (typeof HEALTH_MONITOR_FALLBACK_TRIGGERS)[number]

export const TASK_TELEGRAM_DELIVERY_VALUES = ['auto', 'always'] as const
export type TaskTelegramDelivery = (typeof TASK_TELEGRAM_DELIVERY_VALUES)[number]

export const TASK_LOOP_DETECTION_METHODS = ['systematic', 'smart', 'auto'] as const
export type TaskLoopDetectionMethod = (typeof TASK_LOOP_DETECTION_METHODS)[number]

export const SETTINGS_TTS_PROVIDERS = ['openai', 'mistral'] as const
export type TtsProvider = (typeof SETTINGS_TTS_PROVIDERS)[number]

export const SETTINGS_TTS_OPENAI_MODELS = ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'] as const
export type TtsOpenAiModel = (typeof SETTINGS_TTS_OPENAI_MODELS)[number]

export const SETTINGS_TTS_RESPONSE_FORMATS = ['mp3', 'wav', 'opus', 'flac'] as const
export type TtsResponseFormat = (typeof SETTINGS_TTS_RESPONSE_FORMATS)[number]

export const SETTINGS_STT_PROVIDERS = ['whisper-url', 'openai', 'ollama'] as const
export type SttProvider = (typeof SETTINGS_STT_PROVIDERS)[number]

export const SETTINGS_STT_OPENAI_MODELS = ['whisper-1', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe'] as const
export type SttOpenAiModel = (typeof SETTINGS_STT_OPENAI_MODELS)[number]

export interface HealthMonitorNotificationTogglesContract {
  healthyToDegraded: boolean
  degradedToHealthy: boolean
  degradedToDown: boolean
  healthyToDown: boolean
  downToFallback: boolean
  fallbackToHealthy: boolean
}

export interface HealthMonitorSettingsContract {
  fallbackTrigger: HealthMonitorFallbackTrigger
  failuresBeforeFallback: number
  recoveryCheckIntervalMinutes: number
  successesBeforeRecovery: number
  notifications: HealthMonitorNotificationTogglesContract
}

export interface MemoryConsolidationSettingsContract {
  enabled: boolean
  runAtHour: number
  lookbackDays: number
  providerId: string
}

export interface FactExtractionSettingsContract {
  enabled: boolean
  providerId: string
  minSessionMessages: number
}

export interface AgentHeartbeatNightModeContract {
  enabled: boolean
  startHour: number
  endHour: number
}

export interface AgentHeartbeatSettingsContract {
  enabled: boolean
  intervalMinutes: number
  nightMode: AgentHeartbeatNightModeContract
}

export interface TasksLoopDetectionSettingsContract {
  enabled: boolean
  method: TaskLoopDetectionMethod
  maxConsecutiveFailures: number
  smartProvider: string
  smartCheckInterval: number
}

export interface TasksSettingsContract {
  defaultProvider: string
  maxDurationMinutes: number
  telegramDelivery: TaskTelegramDelivery
  loopDetection: TasksLoopDetectionSettingsContract
  statusUpdateIntervalMinutes: number
}

export interface TtsSettingsContract {
  enabled: boolean
  provider: TtsProvider
  providerId: string
  openaiModel: TtsOpenAiModel
  openaiVoice: string
  openaiInstructions: string
  mistralVoice: string
  responseFormat: TtsResponseFormat
}

export interface SttRewriteSettingsContract {
  enabled: boolean
  providerId: string
}

export interface SttSettingsContract {
  enabled: boolean
  provider: SttProvider
  whisperUrl: string
  providerId: string
  openaiModel: SttOpenAiModel
  ollamaModel: string
  rewrite: SttRewriteSettingsContract
}

export interface SettingsContract {
  sessionTimeoutMinutes: number
  sessionSummaryProviderId: string
  language: string
  timezone: string
  healthMonitorIntervalMinutes: number
  batchingDelayMs: number
  uploadRetentionDays: number
  telegramEnabled: boolean
  telegramBotToken: string
  healthMonitor: HealthMonitorSettingsContract
  memoryConsolidation: MemoryConsolidationSettingsContract
  factExtraction: FactExtractionSettingsContract
  agentHeartbeat: AgentHeartbeatSettingsContract
  tasks: TasksSettingsContract
  tts: TtsSettingsContract
  stt: SttSettingsContract
}

export type SettingsUpdateContract = DeepPartial<SettingsContract>

export interface SettingsStorageContract {
  sessionTimeoutMinutes?: number
  sessionSummaryProviderId?: string
  language?: string
  timezone?: string
  healthMonitorIntervalMinutes?: number
  healthMonitor?: Partial<HealthMonitorSettingsContract> & { intervalMinutes?: number }
  batchingDelayMs?: number
  uploadRetentionDays?: number
  memoryConsolidation?: Partial<MemoryConsolidationSettingsContract>
  factExtraction?: Partial<FactExtractionSettingsContract>
  agentHeartbeat?: Partial<AgentHeartbeatSettingsContract>
  tasks?: Partial<TasksSettingsContract>
  tts?: Partial<TtsSettingsContract>
  stt?: Partial<SttSettingsContract>
}

export interface TelegramSettingsStorageContract {
  enabled?: boolean
  botToken?: string
  adminUserIds?: number[]
  pollingMode?: boolean
  webhookUrl?: string
  batchingDelayMs?: number
}

export type HealthMonitorSettingsUpdateContract = DeepPartial<HealthMonitorSettingsContract> & {
  intervalMinutes?: number
}

export type LegacyCompatibleSettingsUpdateContract = SettingsUpdateContract & {
  healthMonitor?: HealthMonitorSettingsUpdateContract
}

export const DEFAULT_HEALTH_MONITOR_NOTIFICATION_TOGGLES: HealthMonitorNotificationTogglesContract = {
  healthyToDegraded: false,
  degradedToHealthy: false,
  degradedToDown: true,
  healthyToDown: true,
  downToFallback: true,
  fallbackToHealthy: true,
}

export const DEFAULT_SETTINGS_CONTRACT: SettingsContract = {
  sessionTimeoutMinutes: 15,
  sessionSummaryProviderId: '',
  language: 'match',
  timezone: 'UTC',
  healthMonitorIntervalMinutes: 5,
  batchingDelayMs: 2500,
  uploadRetentionDays: 30,
  telegramEnabled: false,
  telegramBotToken: '',
  healthMonitor: {
    fallbackTrigger: 'down',
    failuresBeforeFallback: 1,
    recoveryCheckIntervalMinutes: 1,
    successesBeforeRecovery: 3,
    notifications: { ...DEFAULT_HEALTH_MONITOR_NOTIFICATION_TOGGLES },
  },
  memoryConsolidation: {
    enabled: false,
    runAtHour: 3,
    lookbackDays: 3,
    providerId: '',
  },
  factExtraction: {
    enabled: false,
    providerId: '',
    minSessionMessages: 3,
  },
  agentHeartbeat: {
    enabled: false,
    intervalMinutes: 60,
    nightMode: {
      enabled: true,
      startHour: 23,
      endHour: 8,
    },
  },
  tasks: {
    defaultProvider: '',
    maxDurationMinutes: 60,
    telegramDelivery: 'auto',
    loopDetection: {
      enabled: true,
      method: 'systematic',
      maxConsecutiveFailures: 3,
      smartProvider: '',
      smartCheckInterval: 5,
    },
    statusUpdateIntervalMinutes: 10,
  },
  tts: {
    enabled: false,
    provider: 'openai',
    providerId: '',
    openaiModel: 'gpt-4o-mini-tts',
    openaiVoice: 'nova',
    openaiInstructions: '',
    mistralVoice: '',
    responseFormat: 'mp3',
  },
  stt: {
    enabled: false,
    provider: 'whisper-url',
    whisperUrl: '',
    providerId: '',
    openaiModel: 'whisper-1',
    ollamaModel: '',
    rewrite: {
      enabled: false,
      providerId: '',
    },
  },
}

export function normalizeSettingsContract(input: DeepPartial<SettingsContract> | null | undefined): SettingsContract {
  const source = input ?? {}

  return {
    sessionTimeoutMinutes: source.sessionTimeoutMinutes ?? DEFAULT_SETTINGS_CONTRACT.sessionTimeoutMinutes,
    sessionSummaryProviderId: source.sessionSummaryProviderId ?? DEFAULT_SETTINGS_CONTRACT.sessionSummaryProviderId,
    language: source.language ?? DEFAULT_SETTINGS_CONTRACT.language,
    timezone: source.timezone ?? DEFAULT_SETTINGS_CONTRACT.timezone,
    healthMonitorIntervalMinutes: source.healthMonitorIntervalMinutes ?? DEFAULT_SETTINGS_CONTRACT.healthMonitorIntervalMinutes,
    batchingDelayMs: source.batchingDelayMs ?? DEFAULT_SETTINGS_CONTRACT.batchingDelayMs,
    uploadRetentionDays: source.uploadRetentionDays ?? DEFAULT_SETTINGS_CONTRACT.uploadRetentionDays,
    telegramEnabled: source.telegramEnabled ?? DEFAULT_SETTINGS_CONTRACT.telegramEnabled,
    telegramBotToken: source.telegramBotToken ?? DEFAULT_SETTINGS_CONTRACT.telegramBotToken,
    healthMonitor: {
      fallbackTrigger: source.healthMonitor?.fallbackTrigger ?? DEFAULT_SETTINGS_CONTRACT.healthMonitor.fallbackTrigger,
      failuresBeforeFallback:
        source.healthMonitor?.failuresBeforeFallback ?? DEFAULT_SETTINGS_CONTRACT.healthMonitor.failuresBeforeFallback,
      recoveryCheckIntervalMinutes:
        source.healthMonitor?.recoveryCheckIntervalMinutes
        ?? DEFAULT_SETTINGS_CONTRACT.healthMonitor.recoveryCheckIntervalMinutes,
      successesBeforeRecovery:
        source.healthMonitor?.successesBeforeRecovery ?? DEFAULT_SETTINGS_CONTRACT.healthMonitor.successesBeforeRecovery,
      notifications: {
        healthyToDegraded:
          source.healthMonitor?.notifications?.healthyToDegraded
          ?? DEFAULT_SETTINGS_CONTRACT.healthMonitor.notifications.healthyToDegraded,
        degradedToHealthy:
          source.healthMonitor?.notifications?.degradedToHealthy
          ?? DEFAULT_SETTINGS_CONTRACT.healthMonitor.notifications.degradedToHealthy,
        degradedToDown:
          source.healthMonitor?.notifications?.degradedToDown
          ?? DEFAULT_SETTINGS_CONTRACT.healthMonitor.notifications.degradedToDown,
        healthyToDown:
          source.healthMonitor?.notifications?.healthyToDown
          ?? DEFAULT_SETTINGS_CONTRACT.healthMonitor.notifications.healthyToDown,
        downToFallback:
          source.healthMonitor?.notifications?.downToFallback
          ?? DEFAULT_SETTINGS_CONTRACT.healthMonitor.notifications.downToFallback,
        fallbackToHealthy:
          source.healthMonitor?.notifications?.fallbackToHealthy
          ?? DEFAULT_SETTINGS_CONTRACT.healthMonitor.notifications.fallbackToHealthy,
      },
    },
    memoryConsolidation: {
      enabled: source.memoryConsolidation?.enabled ?? DEFAULT_SETTINGS_CONTRACT.memoryConsolidation.enabled,
      runAtHour: source.memoryConsolidation?.runAtHour ?? DEFAULT_SETTINGS_CONTRACT.memoryConsolidation.runAtHour,
      lookbackDays: source.memoryConsolidation?.lookbackDays ?? DEFAULT_SETTINGS_CONTRACT.memoryConsolidation.lookbackDays,
      providerId: source.memoryConsolidation?.providerId ?? DEFAULT_SETTINGS_CONTRACT.memoryConsolidation.providerId,
    },
    factExtraction: {
      enabled: source.factExtraction?.enabled ?? DEFAULT_SETTINGS_CONTRACT.factExtraction.enabled,
      providerId: source.factExtraction?.providerId ?? DEFAULT_SETTINGS_CONTRACT.factExtraction.providerId,
      minSessionMessages:
        source.factExtraction?.minSessionMessages ?? DEFAULT_SETTINGS_CONTRACT.factExtraction.minSessionMessages,
    },
    agentHeartbeat: {
      enabled: source.agentHeartbeat?.enabled ?? DEFAULT_SETTINGS_CONTRACT.agentHeartbeat.enabled,
      intervalMinutes: source.agentHeartbeat?.intervalMinutes ?? DEFAULT_SETTINGS_CONTRACT.agentHeartbeat.intervalMinutes,
      nightMode: {
        enabled: source.agentHeartbeat?.nightMode?.enabled ?? DEFAULT_SETTINGS_CONTRACT.agentHeartbeat.nightMode.enabled,
        startHour:
          source.agentHeartbeat?.nightMode?.startHour ?? DEFAULT_SETTINGS_CONTRACT.agentHeartbeat.nightMode.startHour,
        endHour: source.agentHeartbeat?.nightMode?.endHour ?? DEFAULT_SETTINGS_CONTRACT.agentHeartbeat.nightMode.endHour,
      },
    },
    tasks: {
      defaultProvider: source.tasks?.defaultProvider ?? DEFAULT_SETTINGS_CONTRACT.tasks.defaultProvider,
      maxDurationMinutes: source.tasks?.maxDurationMinutes ?? DEFAULT_SETTINGS_CONTRACT.tasks.maxDurationMinutes,
      telegramDelivery: source.tasks?.telegramDelivery ?? DEFAULT_SETTINGS_CONTRACT.tasks.telegramDelivery,
      loopDetection: {
        enabled: source.tasks?.loopDetection?.enabled ?? DEFAULT_SETTINGS_CONTRACT.tasks.loopDetection.enabled,
        method: source.tasks?.loopDetection?.method ?? DEFAULT_SETTINGS_CONTRACT.tasks.loopDetection.method,
        maxConsecutiveFailures:
          source.tasks?.loopDetection?.maxConsecutiveFailures
          ?? DEFAULT_SETTINGS_CONTRACT.tasks.loopDetection.maxConsecutiveFailures,
        smartProvider:
          source.tasks?.loopDetection?.smartProvider ?? DEFAULT_SETTINGS_CONTRACT.tasks.loopDetection.smartProvider,
        smartCheckInterval:
          source.tasks?.loopDetection?.smartCheckInterval
          ?? DEFAULT_SETTINGS_CONTRACT.tasks.loopDetection.smartCheckInterval,
      },
      statusUpdateIntervalMinutes:
        source.tasks?.statusUpdateIntervalMinutes ?? DEFAULT_SETTINGS_CONTRACT.tasks.statusUpdateIntervalMinutes,
    },
    tts: {
      enabled: source.tts?.enabled ?? DEFAULT_SETTINGS_CONTRACT.tts.enabled,
      provider: source.tts?.provider ?? DEFAULT_SETTINGS_CONTRACT.tts.provider,
      providerId: source.tts?.providerId ?? DEFAULT_SETTINGS_CONTRACT.tts.providerId,
      openaiModel: source.tts?.openaiModel ?? DEFAULT_SETTINGS_CONTRACT.tts.openaiModel,
      openaiVoice: source.tts?.openaiVoice ?? DEFAULT_SETTINGS_CONTRACT.tts.openaiVoice,
      openaiInstructions: source.tts?.openaiInstructions ?? DEFAULT_SETTINGS_CONTRACT.tts.openaiInstructions,
      mistralVoice: source.tts?.mistralVoice ?? DEFAULT_SETTINGS_CONTRACT.tts.mistralVoice,
      responseFormat: source.tts?.responseFormat ?? DEFAULT_SETTINGS_CONTRACT.tts.responseFormat,
    },
    stt: {
      enabled: source.stt?.enabled ?? DEFAULT_SETTINGS_CONTRACT.stt.enabled,
      provider: source.stt?.provider ?? DEFAULT_SETTINGS_CONTRACT.stt.provider,
      whisperUrl: source.stt?.whisperUrl ?? DEFAULT_SETTINGS_CONTRACT.stt.whisperUrl,
      providerId: source.stt?.providerId ?? DEFAULT_SETTINGS_CONTRACT.stt.providerId,
      openaiModel: source.stt?.openaiModel ?? DEFAULT_SETTINGS_CONTRACT.stt.openaiModel,
      ollamaModel: source.stt?.ollamaModel ?? DEFAULT_SETTINGS_CONTRACT.stt.ollamaModel,
      rewrite: {
        enabled: source.stt?.rewrite?.enabled ?? DEFAULT_SETTINGS_CONTRACT.stt.rewrite.enabled,
        providerId: source.stt?.rewrite?.providerId ?? DEFAULT_SETTINGS_CONTRACT.stt.rewrite.providerId,
      },
    },
  }
}

export function withLegacySettingsPayloadCompatibility(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (payload.healthMonitorIntervalMinutes !== undefined) {
    return payload
  }

  const healthMonitor = payload.healthMonitor
  if (!healthMonitor || typeof healthMonitor !== 'object') {
    return payload
  }

  const intervalMinutes = (healthMonitor as Record<string, unknown>).intervalMinutes
  if (intervalMinutes === undefined) {
    return payload
  }

  return {
    ...payload,
    healthMonitorIntervalMinutes: intervalMinutes,
  }
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object
    ? DeepPartial<T[K]>
    : T[K]
}
