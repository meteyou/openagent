/**
 * Dashboard data composable.
 *
 * Owns every API call the dashboard page needs and exposes derived,
 * ready-to-render computed values. The page stays a thin orchestrator.
 */

// ── Shared types ────────────────────────────────────────────────
export interface HealthSnapshot {
  agent: { status: 'running' | 'stopped' }
  provider: {
    id: string
    name: string
    model: string
    status: ProviderStatus
  } | null
  lastCheck: {
    checkedAt: string
    providerId: string | null
    providerName: string | null
    providerType: string | null
    model: string | null
    status: ProviderStatus
    latencyMs: number | null
    errorMessage: string | null
  } | null
  queueDepth: number
  activity: {
    messagesToday: number
    sessionsToday: number
  }
  intervalMinutes: number
}

export interface HealthHistoryEntry {
  id: number
  timestamp: string
  provider: string | null
  status: ProviderStatus
  latencyMs: number | null
  errorMessage: string | null
}

export type ProviderStatus = 'healthy' | 'degraded' | 'down' | 'unconfigured'

interface UsageTotals {
  requests: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCost: number
}

// ── Composable ──────────────────────────────────────────────────
export function useDashboard() {
  const { apiFetch } = useApi()

  const loading = ref(false)
  const error = ref<string | null>(null)

  const health = ref<HealthSnapshot>({
    agent: { status: 'stopped' },
    provider: null,
    lastCheck: null,
    queueDepth: 0,
    activity: { messagesToday: 0, sessionsToday: 0 },
    intervalMinutes: 5,
  })

  const healthHistory = ref<HealthHistoryEntry[]>([])
  const providersCount = ref(0)
  const usageToday = ref<UsageTotals>({
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
  })

  // ── Derived state ─────────────────────────────────────────────
  const providerName = computed(() => health.value.provider?.name ?? null)
  const providerModel = computed(() => health.value.provider?.model ?? null)
  const providerStatus = computed((): ProviderStatus => health.value.provider?.status ?? 'unconfigured')
  const agentStatus = computed(() => health.value.agent.status)

  const lastCheckTime = computed(() => health.value.lastCheck?.checkedAt ?? null)
  const lastCheckLatency = computed(() => health.value.lastCheck?.latencyMs ?? null)
  const lastCheckError = computed(() => health.value.lastCheck?.errorMessage ?? null)

  // ── Data fetching ─────────────────────────────────────────────
  async function load() {
    loading.value = true
    error.value = null

    try {
      const [healthData, historyData, providersData, summaryData] = await Promise.all([
        apiFetch<HealthSnapshot>('/api/health'),
        apiFetch<{ history: HealthHistoryEntry[] }>('/api/health/history?limit=5'),
        apiFetch<{ providers: Array<{ id: string }> }>('/api/providers'),
        apiFetch<{ today: UsageTotals; allTime: UsageTotals }>('/api/stats/summary'),
      ])

      health.value = healthData
      healthHistory.value = historyData.history
      providersCount.value = providersData.providers.length
      usageToday.value = summaryData.today
    } catch (err) {
      error.value = (err as Error).message
    } finally {
      loading.value = false
    }
  }

  return {
    // state
    loading: readonly(loading),
    error,
    health: readonly(health),
    healthHistory: readonly(healthHistory),
    providersCount: readonly(providersCount),
    usageToday: readonly(usageToday),

    // derived
    providerName,
    providerModel,
    providerStatus,
    agentStatus,
    lastCheckTime,
    lastCheckLatency,
    lastCheckError,

    // actions
    load,
  }
}
