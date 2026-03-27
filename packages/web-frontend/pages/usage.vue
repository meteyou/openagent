<template>
  <div v-if="!isAdmin" class="admin-gate">
    <span class="gate-icon">🔒</span>
    <h1>{{ $t('admin.title') }}</h1>
    <p>{{ $t('admin.description') }}</p>
  </div>

  <div v-else class="usage-page">
    <header class="page-hero glass-panel">
      <div>
        <p class="eyebrow">{{ $t('usage.kicker') }}</p>
        <h1>{{ $t('usage.title') }}</h1>
        <p class="page-subtitle">{{ $t('usage.subtitle') }}</p>
      </div>

      <button class="btn btn-outline" :disabled="loading" @click="loadStats">
        {{ $t('usage.refresh') }}
      </button>
    </header>

    <div v-if="error" class="error-banner">
      <span>{{ error }}</span>
      <button class="error-dismiss" @click="error = null">✕</button>
    </div>

    <div v-if="loading" class="loading-state">{{ $t('usage.loading') }}</div>

    <template v-else>
      <section class="summary-grid">
        <article v-for="card in summaryCards" :key="card.label" class="summary-card glass-panel">
          <span class="summary-label">{{ card.label }}</span>
          <strong class="summary-value">{{ card.value }}</strong>
          <span class="summary-meta">{{ card.meta }}</span>
        </article>
      </section>

      <section class="filters-panel glass-panel">
        <div class="section-heading">
          <div>
            <h2>{{ $t('usage.filters.title') }}</h2>
            <p>{{ $t('usage.filters.description') }}</p>
          </div>
        </div>

        <form class="filters-grid" @submit.prevent="loadStats">
          <label class="field">
            <span>{{ $t('usage.filters.dateFrom') }}</span>
            <input v-model="filters.dateFrom" type="date" class="input" />
          </label>

          <label class="field">
            <span>{{ $t('usage.filters.dateTo') }}</span>
            <input v-model="filters.dateTo" type="date" class="input" />
          </label>

          <label class="field">
            <span>{{ $t('usage.filters.provider') }}</span>
            <select v-model="filters.provider" class="input" @change="filters.model = ''">
              <option value="">{{ $t('usage.filters.allProviders') }}</option>
              <option v-for="provider in availableProviders" :key="provider" :value="provider">
                {{ provider }}
              </option>
            </select>
          </label>

          <label class="field">
            <span>{{ $t('usage.filters.model') }}</span>
            <select v-model="filters.model" class="input">
              <option value="">{{ $t('usage.filters.allModels') }}</option>
              <option v-for="model in availableModels" :key="model" :value="model">
                {{ model }}
              </option>
            </select>
          </label>

          <div class="filter-actions">
            <button class="btn btn-primary" type="submit">{{ $t('usage.filters.apply') }}</button>
            <button class="btn btn-ghost" type="button" @click="resetFilters">{{ $t('usage.filters.reset') }}</button>
          </div>
        </form>
      </section>

      <section v-if="!hasAnyUsage" class="empty-state glass-panel">
        <span class="empty-icon">📉</span>
        <h2>{{ $t('usage.emptyTitle') }}</h2>
        <p>{{ $t('usage.emptyDescription') }}</p>
      </section>

      <template v-else>
        <section v-if="!hasFilteredResults" class="empty-state compact glass-panel">
          <span class="empty-icon">🧭</span>
          <h2>{{ $t('usage.emptyFilteredTitle') }}</h2>
          <p>{{ $t('usage.emptyFilteredDescription') }}</p>
        </section>

        <section class="chart-panel glass-panel">
          <div class="section-heading chart-heading">
            <div>
              <h2>{{ $t('usage.chart.title') }}</h2>
              <p>{{ $t('usage.chart.description') }}</p>
            </div>
            <div class="section-metric">
              <span>{{ $t('usage.chart.rangeLabel') }}</span>
              <strong>{{ chartRangeLabel }}</strong>
            </div>
          </div>

          <div v-if="chartSeries.length === 0 || chartMax === 0" class="chart-empty">
            {{ $t('usage.chart.empty') }}
          </div>

          <div v-else class="chart-shell">
            <div class="chart-axis">
              <span>{{ formatNumber(chartMax) }}</span>
              <span>{{ formatNumber(Math.round(chartMax / 2)) }}</span>
              <span>{{ formatNumber(0) }}</span>
            </div>

            <div class="chart-grid">
              <div class="chart-lines">
                <span />
                <span />
                <span />
              </div>

              <div class="chart-bars" :style="{ gridTemplateColumns: `repeat(${chartSeries.length}, minmax(0, 1fr))` }">
                <div
                  v-for="point in chartSeries"
                  :key="point.day"
                  class="chart-bar-group"
                  :title="`${formatFullDate(point.day)} · ${formatNumber(point.totalTokens)} ${$t('usage.table.columns.totalTokens')} · ${formatCurrency(point.estimatedCost)}`"
                >
                  <span class="chart-bar" :style="{ height: `${point.height}%` }" />
                  <span class="chart-label">{{ point.label }}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="table-panel glass-panel">
          <div class="section-heading">
            <div>
              <h2>{{ $t('usage.table.title') }}</h2>
              <p>{{ $t('usage.table.description') }}</p>
            </div>
            <div class="section-metric">
              <span>{{ $t('usage.table.selectedTotal') }}</span>
              <strong>{{ formatNumber(breakdown.totals.totalTokens) }}</strong>
            </div>
          </div>

          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>{{ $t('usage.table.columns.provider') }}</th>
                  <th>{{ $t('usage.table.columns.model') }}</th>
                  <th>{{ $t('usage.table.columns.promptTokens') }}</th>
                  <th>{{ $t('usage.table.columns.completionTokens') }}</th>
                  <th>{{ $t('usage.table.columns.totalTokens') }}</th>
                  <th>{{ $t('usage.table.columns.cost') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="breakdown.rows.length === 0">
                  <td colspan="6" class="empty-row">{{ $t('usage.table.empty') }}</td>
                </tr>
                <tr v-for="row in breakdown.rows" :key="`${row.provider}-${row.model}`">
                  <td>{{ row.provider || '—' }}</td>
                  <td class="mono">{{ row.model || '—' }}</td>
                  <td>{{ formatNumber(row.promptTokens) }}</td>
                  <td>{{ formatNumber(row.completionTokens) }}</td>
                  <td>{{ formatNumber(row.totalTokens) }}</td>
                  <td>{{ formatCurrency(row.estimatedCost) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
interface UsageTotals {
  requests: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCost: number
}

interface UsageSummaryResponse {
  today: UsageTotals
  week: UsageTotals
  month: UsageTotals
  allTime: UsageTotals
}

interface UsageRow extends UsageTotals {
  provider?: string
  model?: string
  day?: string
  hour?: string
}

interface UsageStatsResponse {
  groupBy: string[]
  rows: UsageRow[]
  totals: UsageTotals
  availableProviders: string[]
  availableModels: string[]
}

const { t, locale } = useI18n()
const { apiFetch } = useApi()
const { user } = useAuth()
const isAdmin = computed(() => user.value?.role === 'admin')

function formatDateInput(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getInitialFilters() {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 29)

  return {
    dateFrom: formatDateInput(start),
    dateTo: formatDateInput(end),
    provider: '',
    model: '',
  }
}

const filters = reactive(getInitialFilters())
const loading = ref(false)
const error = ref<string | null>(null)
const summary = ref<UsageSummaryResponse>({
  today: { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
  week: { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
  month: { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
  allTime: { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
})
const daily = ref<UsageStatsResponse>({
  groupBy: ['day'],
  rows: [],
  totals: { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
  availableProviders: [],
  availableModels: [],
})
const breakdown = ref<UsageStatsResponse>({
  groupBy: ['provider', 'model'],
  rows: [],
  totals: { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
  availableProviders: [],
  availableModels: [],
})

const availableProviders = ref<string[]>([])
const availableModels = ref<string[]>([])

const hasAnyUsage = computed(() => summary.value.allTime.totalTokens > 0)
const hasFilteredResults = computed(() => breakdown.value.rows.length > 0 || daily.value.rows.some((row) => row.totalTokens > 0))

const summaryCards = computed(() => [
  {
    label: t('usage.summary.tokensToday'),
    value: formatNumber(summary.value.today.totalTokens),
    meta: t('usage.summary.tokensTodayMeta'),
  },
  {
    label: t('usage.summary.costToday'),
    value: formatCurrency(summary.value.today.estimatedCost),
    meta: t('usage.summary.costTodayMeta'),
  },
  {
    label: t('usage.summary.tokensMonth'),
    value: formatNumber(summary.value.month.totalTokens),
    meta: t('usage.summary.tokensMonthMeta'),
  },
  {
    label: t('usage.summary.costMonth'),
    value: formatCurrency(summary.value.month.estimatedCost),
    meta: t('usage.summary.costMonthMeta'),
  },
])

const chartSeries = computed(() => {
  if (!filters.dateFrom || !filters.dateTo) {
    return [] as Array<{ day: string; label: string; totalTokens: number; estimatedCost: number; height: number }>
  }

  const start = new Date(`${filters.dateFrom}T00:00:00`)
  const end = new Date(`${filters.dateTo}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return []
  }

  const dailyMap = new Map(
    daily.value.rows
      .filter((row) => row.day)
      .map((row) => [row.day as string, row])
  )

  const points: Array<{ day: string; label: string; totalTokens: number; estimatedCost: number }> = []
  const cursor = new Date(start)

  while (cursor <= end) {
    const day = formatDateInput(cursor)
    const row = dailyMap.get(day)
    points.push({
      day,
      label: formatShortDate(day),
      totalTokens: row?.totalTokens ?? 0,
      estimatedCost: row?.estimatedCost ?? 0,
    })
    cursor.setDate(cursor.getDate() + 1)
  }

  const max = Math.max(...points.map((point) => point.totalTokens), 0)

  return points.map((point) => ({
    ...point,
    height: max > 0 ? Math.max((point.totalTokens / max) * 100, point.totalTokens > 0 ? 8 : 0) : 0,
  }))
})

const chartMax = computed(() => Math.max(...chartSeries.value.map((point) => point.totalTokens), 0))
const chartRangeLabel = computed(() => {
  if (!filters.dateFrom || !filters.dateTo) {
    return '—'
  }

  return `${formatFullDate(filters.dateFrom)} → ${formatFullDate(filters.dateTo)}`
})

onMounted(async () => {
  if (!isAdmin.value) return
  await loadStats()
})

async function loadStats() {
  loading.value = true
  error.value = null

  try {
    const [summaryData, dailyData, breakdownData] = await Promise.all([
      apiFetch<UsageSummaryResponse>('/api/stats/summary'),
      apiFetch<UsageStatsResponse>(`/api/stats/usage?${buildQuery(['day'])}`),
      apiFetch<UsageStatsResponse>(`/api/stats/usage?${buildQuery(['provider', 'model'])}`),
    ])

    summary.value = summaryData
    daily.value = dailyData
    breakdown.value = breakdownData
    availableProviders.value = dailyData.availableProviders
    availableModels.value = dailyData.availableModels
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

function buildQuery(groupBy: string[]): string {
  const params = new URLSearchParams()
  params.set('group_by', groupBy.join(','))

  if (filters.dateFrom) {
    params.set('date_from', filters.dateFrom)
  }

  if (filters.dateTo) {
    params.set('date_to', filters.dateTo)
  }

  if (filters.provider) {
    params.set('provider', filters.provider)
  }

  if (filters.model) {
    params.set('model', filters.model)
  }

  return params.toString()
}

function resetFilters() {
  Object.assign(filters, getInitialFilters())
  loadStats()
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(locale.value).format(value)
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat(locale.value, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat(locale.value, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${value}T00:00:00`))
}

function formatFullDate(value: string): string {
  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: 'medium',
  }).format(new Date(`${value}T00:00:00`))
}
</script>

<style scoped>
.usage-page {
  padding: 24px;
  max-width: 1240px;
  margin: 0 auto;
  height: 100%;
  overflow-y: auto;
}

.admin-gate {
  display: grid;
  place-items: center;
  gap: 10px;
  padding: 40px;
  height: 100%;
  color: var(--color-text-muted);
  text-align: center;
}

.gate-icon {
  font-size: 44px;
}

.glass-panel {
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.14), transparent 32%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.015)),
    var(--color-bg-secondary);
  border: 1px solid rgba(255, 255, 255, 0.07);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.22);
}

.page-hero {
  border-radius: 24px;
  padding: 28px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 18px;
  margin-bottom: 18px;
}

.eyebrow {
  font-size: 12px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #7dd3fc;
  margin-bottom: 8px;
}

.page-hero h1 {
  margin: 0;
  font-size: 30px;
}

.page-subtitle {
  margin-top: 10px;
  color: var(--color-text-secondary);
  max-width: 680px;
}

.error-banner {
  padding: 12px 16px;
  border-radius: 14px;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 14px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid var(--color-error, #ef4444);
  color: var(--color-error, #ef4444);
}

.error-dismiss {
  background: none;
  border: none;
  color: inherit;
}

.loading-state {
  display: grid;
  place-items: center;
  padding: 120px 20px;
  color: var(--color-text-muted);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}

.summary-card {
  border-radius: 20px;
  padding: 18px;
  position: relative;
  overflow: hidden;
}

.summary-card::after {
  content: '';
  position: absolute;
  inset: auto -12% -30% auto;
  width: 120px;
  height: 120px;
  background: radial-gradient(circle, rgba(56, 189, 248, 0.12), transparent 70%);
  pointer-events: none;
}

.summary-label {
  display: block;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
}

.summary-value {
  display: block;
  margin-top: 12px;
  font-size: 30px;
  color: var(--color-text);
}

.summary-meta {
  display: block;
  margin-top: 10px;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.filters-panel,
.chart-panel,
.table-panel,
.empty-state {
  border-radius: 24px;
  padding: 22px;
  margin-bottom: 16px;
}

.section-heading {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.section-heading h2 {
  font-size: 18px;
}

.section-heading p {
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-text-muted);
}

.section-metric {
  min-width: 180px;
  text-align: right;
}

.section-metric span {
  display: block;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
}

.section-metric strong {
  display: block;
  margin-top: 8px;
  font-size: 18px;
}

.filters-grid {
  margin-top: 18px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  align-items: end;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field span {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
}

.input {
  width: 100%;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(8, 12, 20, 0.6);
  color: var(--color-text);
  min-height: 46px;
  padding: 0 14px;
}

.filter-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 16px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  border: 1px solid transparent;
  transition: transform 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.btn:hover:not(:disabled) {
  transform: translateY(-1px);
}

.btn-primary {
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.9), rgba(59, 130, 246, 0.9));
  color: white;
}

.btn-outline,
.btn-ghost {
  background: rgba(255, 255, 255, 0.03);
  border-color: var(--color-border);
  color: var(--color-text-secondary);
}

.btn-outline:hover:not(:disabled),
.btn-ghost:hover:not(:disabled) {
  background: var(--color-bg-tertiary);
  color: var(--color-text);
}

.empty-state {
  display: grid;
  place-items: center;
  text-align: center;
  gap: 10px;
  padding: 40px 24px;
}

.empty-state.compact {
  place-items: start center;
}

.empty-icon {
  font-size: 34px;
}

.empty-state p {
  max-width: 520px;
  color: var(--color-text-secondary);
}

.chart-shell {
  margin-top: 20px;
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 14px;
  min-height: 320px;
}

.chart-axis {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: flex-end;
  color: var(--color-text-muted);
  font-size: 12px;
  padding: 8px 0 28px;
}

.chart-grid {
  position: relative;
  min-height: 320px;
}

.chart-lines {
  position: absolute;
  inset: 0 0 26px 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.chart-lines span {
  border-top: 1px dashed rgba(255, 255, 255, 0.1);
}

.chart-bars {
  position: absolute;
  inset: 0 0 0 0;
  display: grid;
  align-items: end;
  gap: 10px;
  padding: 6px 0 0;
}

.chart-bar-group {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: end;
  align-items: center;
  gap: 10px;
  height: 100%;
}

.chart-bar {
  width: 100%;
  max-width: 26px;
  border-radius: 999px 999px 10px 10px;
  background: linear-gradient(180deg, rgba(125, 211, 252, 0.95), rgba(37, 99, 235, 0.8));
  box-shadow: 0 10px 24px rgba(14, 165, 233, 0.25);
}

.chart-label {
  font-size: 11px;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.chart-empty {
  display: grid;
  place-items: center;
  min-height: 220px;
  color: var(--color-text-muted);
}

.table-wrap {
  margin-top: 18px;
  overflow-x: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
}

.data-table th,
.data-table td {
  padding: 12px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  text-align: left;
  font-size: 13px;
}

.data-table th {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
}

.empty-row {
  text-align: center !important;
  color: var(--color-text-muted);
  padding: 24px !important;
}

.mono {
  font-family: 'SF Mono', 'Fira Code', monospace;
}

@media (max-width: 1080px) {
  .usage-page {
    padding: 16px;
  }

  .summary-grid,
  .filters-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .filter-actions {
    justify-content: flex-start;
  }
}

@media (max-width: 820px) {
  .page-hero,
  .section-heading,
  .chart-shell {
    grid-template-columns: minmax(0, 1fr);
    display: grid;
  }

  .page-hero {
    padding: 22px;
  }

  .summary-grid,
  .filters-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .section-metric {
    text-align: left;
    min-width: 0;
  }

  .chart-shell {
    gap: 10px;
  }

  .chart-axis {
    flex-direction: row;
    padding: 0;
  }

  .chart-grid {
    min-height: 260px;
  }
}
</style>
