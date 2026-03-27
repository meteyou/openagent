<template>
  <!-- Admin gate -->
  <div v-if="!isAdmin" class="flex h-full flex-col items-center justify-center gap-3 p-10 text-center text-muted-foreground">
    <AppIcon name="lock" size="xl" class="h-10 w-10" />
    <h1 class="text-xl font-semibold text-foreground">{{ $t('admin.title') }}</h1>
    <p class="text-sm">{{ $t('admin.description') }}</p>
  </div>

  <!-- Page body -->
  <div v-else class="flex h-full flex-col overflow-hidden">
    <PageHeader :title="$t('settings.title')" :subtitle="$t('settings.subtitle')" />

    <div class="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-y-auto p-6">

    <!-- Error banner -->
    <Alert v-if="error" variant="destructive" class="mb-4">
      <AlertDescription class="flex items-center justify-between">
        <span>{{ error }}</span>
        <button
          type="button"
          class="ml-2 opacity-70 transition-opacity hover:opacity-100"
          :aria-label="$t('aria.closeAlert')"
          @click="clearMessages()"
        >
          <AppIcon name="close" class="h-4 w-4" />
        </button>
      </AlertDescription>
    </Alert>

    <!-- Success banner -->
    <Alert v-if="successMessage" variant="success" class="mb-4">
      <AlertDescription class="flex items-center justify-between">
        <span>{{ $t('settings.saveSuccess') }}</span>
        <button
          type="button"
          class="ml-2 opacity-70 transition-opacity hover:opacity-100"
          :aria-label="$t('aria.closeAlert')"
          @click="clearMessages()"
        >
          <AppIcon name="close" class="h-4 w-4" />
        </button>
      </AlertDescription>
    </Alert>

    <!-- Loading state -->
    <div v-if="loading" class="flex flex-1 items-center justify-center py-20 text-sm text-muted-foreground">
      {{ $t('settings.loading') }}
    </div>

    <!-- Form -->
    <div v-else-if="form" class="flex flex-col gap-4">
      <!-- Sessions section -->
      <Card>
        <CardHeader>
          <CardTitle>{{ $t('settings.sessionSection') }}</CardTitle>
          <CardDescription>{{ $t('settings.sessionSectionDescription') }}</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="flex flex-col gap-1.5">
            <Label for="session-timeout">{{ $t('settings.sessionTimeout') }}</Label>
            <div class="flex items-center gap-3">
              <Input
                id="session-timeout"
                v-model.number="form.sessionTimeoutMinutes"
                type="number"
                min="1"
                max="1440"
                class="w-32"
              />
              <span class="text-sm text-muted-foreground">{{ $t('settings.minutes') }}</span>
            </div>
            <p class="text-xs text-muted-foreground">{{ $t('settings.sessionTimeoutHint') }}</p>
          </div>
        </CardContent>
      </Card>

      <!-- Language section -->
      <Card>
        <CardHeader>
          <CardTitle>{{ $t('settings.languageSection') }}</CardTitle>
          <CardDescription>{{ $t('settings.languageSectionDescription') }}</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="flex flex-col gap-1.5">
            <Label for="language-select">{{ $t('settings.language') }}</Label>
            <Select id="language-select" v-model="form.language">
              <option value="match">{{ $t('settings.languageMatch') }}</option>
              <option value="English">{{ $t('settings.languages.english') }}</option>
              <option value="German">{{ $t('settings.languages.german') }}</option>
              <option value="French">{{ $t('settings.languages.french') }}</option>
              <option value="Spanish">{{ $t('settings.languages.spanish') }}</option>
              <option value="Italian">{{ $t('settings.languages.italian') }}</option>
              <option value="Portuguese">{{ $t('settings.languages.portuguese') }}</option>
              <option value="Dutch">{{ $t('settings.languages.dutch') }}</option>
              <option value="Russian">{{ $t('settings.languages.russian') }}</option>
              <option value="Chinese">{{ $t('settings.languages.chinese') }}</option>
              <option value="Japanese">{{ $t('settings.languages.japanese') }}</option>
              <option value="Korean">{{ $t('settings.languages.korean') }}</option>
            </Select>
            <p class="text-xs text-muted-foreground">{{ $t('settings.languageHint') }}</p>
          </div>
        </CardContent>
      </Card>

      <!-- Agent behavior section -->
      <Card>
        <CardHeader>
          <CardTitle>{{ $t('settings.agentSection') }}</CardTitle>
          <CardDescription>{{ $t('settings.agentSectionDescription') }}</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="flex flex-col gap-1.5">
              <Label for="heartbeat-interval">{{ $t('settings.heartbeatInterval') }}</Label>
              <div class="flex items-center gap-3">
                <Input
                  id="heartbeat-interval"
                  v-model.number="form.heartbeatIntervalMinutes"
                  type="number"
                  min="1"
                  max="60"
                  class="w-28"
                />
                <span class="text-sm text-muted-foreground">{{ $t('settings.minutes') }}</span>
              </div>
              <p class="text-xs text-muted-foreground">{{ $t('settings.heartbeatHint') }}</p>
            </div>

            <div class="flex flex-col gap-1.5">
              <Label for="batching-delay">{{ $t('settings.batchingDelay') }}</Label>
              <div class="flex items-center gap-3">
                <Input
                  id="batching-delay"
                  v-model.number="form.batchingDelayMs"
                  type="number"
                  min="0"
                  max="10000"
                  step="100"
                  class="w-28"
                />
                <span class="text-sm text-muted-foreground">ms</span>
              </div>
              <p class="text-xs text-muted-foreground">{{ $t('settings.batchingDelayHint') }}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Memory consolidation section -->
      <Card>
        <CardHeader>
          <CardTitle>{{ $t('settings.consolidationSection') }}</CardTitle>
          <CardDescription>{{ $t('settings.consolidationSectionDescription') }}</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="flex flex-col gap-5">
            <!-- Enable toggle -->
            <div class="flex items-center justify-between">
              <div class="flex flex-col gap-0.5">
                <Label for="consolidation-enabled">{{ $t('settings.consolidationEnabled') }}</Label>
                <p class="text-xs text-muted-foreground">{{ $t('settings.consolidationEnabledHint') }}</p>
              </div>
              <Switch
                id="consolidation-enabled"
                v-model="form.memoryConsolidation.enabled"
              />
            </div>

            <!-- Settings grid (only shown when enabled) -->
            <div v-if="form.memoryConsolidation.enabled" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div class="flex flex-col gap-1.5">
                <Label for="consolidation-hour">{{ $t('settings.consolidationRunAtHour') }}</Label>
                <div class="flex items-center gap-3">
                  <Input
                    id="consolidation-hour"
                    v-model.number="form.memoryConsolidation.runAtHour"
                    type="number"
                    min="0"
                    max="23"
                    class="w-24"
                  />
                  <span class="text-sm text-muted-foreground">{{ $t('settings.oClock') }}</span>
                </div>
                <p class="text-xs text-muted-foreground">{{ $t('settings.consolidationRunAtHourHint') }}</p>
              </div>

              <div class="flex flex-col gap-1.5">
                <Label for="consolidation-days">{{ $t('settings.consolidationLookbackDays') }}</Label>
                <div class="flex items-center gap-3">
                  <Input
                    id="consolidation-days"
                    v-model.number="form.memoryConsolidation.lookbackDays"
                    type="number"
                    min="1"
                    max="30"
                    class="w-24"
                  />
                  <span class="text-sm text-muted-foreground">{{ $t('settings.days') }}</span>
                </div>
                <p class="text-xs text-muted-foreground">{{ $t('settings.consolidationLookbackDaysHint') }}</p>
              </div>
            </div>

            <!-- Provider select (only shown when enabled) -->
            <div v-if="form.memoryConsolidation.enabled" class="flex flex-col gap-1.5">
              <Label for="consolidation-provider">{{ $t('settings.consolidationProvider') }}</Label>
              <Select id="consolidation-provider" v-model="form.memoryConsolidation.providerId">
                <option value="">{{ $t('settings.consolidationProviderDefault') }}</option>
                <option v-for="p in providers" :key="p.id" :value="p.id">
                  {{ p.name }} ({{ p.defaultModel }})
                </option>
              </Select>
              <p class="text-xs text-muted-foreground">{{ $t('settings.consolidationProviderHint') }}</p>
            </div>

            <!-- Manual run + status (only shown when enabled) -->
            <div v-if="form.memoryConsolidation.enabled" class="flex items-center gap-4">
              <Button
                variant="outline"
                size="sm"
                :disabled="consolidationRunning"
                @click="handleRunConsolidation"
              >
                <span
                  v-if="consolidationRunning"
                  class="mr-1 h-3.5 w-3.5 animate-spin rounded-full border-2 border-foreground/30 border-t-foreground"
                  aria-hidden="true"
                />
                {{ consolidationRunning ? $t('settings.consolidationRunning') : $t('settings.consolidationRunNow') }}
              </Button>
              <div v-if="consolidationStatus" class="text-xs text-muted-foreground">
                <span class="font-medium">{{ $t('settings.consolidationLastRun') }}:</span>
                {{ consolidationStatus.lastRun ? new Date(consolidationStatus.lastRun).toLocaleString() : $t('settings.consolidationNeverRun') }}
                <template v-if="consolidationStatus.lastResult">
                  · <span :class="consolidationStatus.lastResult.updated ? 'text-green-600 dark:text-green-400' : ''">
                    {{ consolidationStatus.lastResult.updated ? $t('settings.consolidationResultUpdated') : $t('settings.consolidationResultNoChange') }}
                  </span>
                </template>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Telegram section -->
      <Card>
        <CardHeader>
          <CardTitle>{{ $t('settings.telegramSection') }}</CardTitle>
          <CardDescription>{{ $t('settings.telegramSectionDescription') }}</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="flex flex-col gap-1.5">
            <Label for="telegram-token">{{ $t('settings.telegramBotToken') }}</Label>
            <Input
              id="telegram-token"
              v-model="form.telegramBotToken"
              type="password"
              autocomplete="off"
              :placeholder="$t('settings.telegramBotTokenPlaceholder')"
            />
            <p class="text-xs text-muted-foreground">{{ $t('settings.telegramBotTokenHint') }}</p>
          </div>
        </CardContent>
      </Card>

      <!-- Save action -->
      <div class="flex justify-end pb-2">
        <Button :disabled="saving" @click="handleSave">
          <span
            v-if="saving"
            class="mr-1 h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground"
            aria-hidden="true"
          />
          {{ $t('settings.save') }}
        </Button>
      </div>
    </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { MemoryConsolidationSettings } from '~/composables/useSettings'

const { user } = useAuth()
const isAdmin = computed(() => user.value?.role === 'admin')
const { apiFetch } = useApi()

const {
  settings,
  loading,
  saving,
  error,
  successMessage,
  fetchSettings,
  updateSettings,
  clearMessages,
} = useSettings()

// Providers list for the consolidation provider dropdown
const { providers, fetchProviders } = useProviders()

// Consolidation status
const consolidationRunning = ref(false)
const consolidationStatus = ref<{
  lastRun: string | null
  lastResult: { updated: boolean; reason?: string } | null
} | null>(null)

const form = ref<{
  sessionTimeoutMinutes: number
  language: string
  heartbeatIntervalMinutes: number
  batchingDelayMs: number
  telegramBotToken: string
  memoryConsolidation: MemoryConsolidationSettings
} | null>(null)

onMounted(async () => {
  if (!isAdmin.value) return
  await Promise.all([
    fetchSettings(),
    fetchProviders(),
    fetchConsolidationStatus(),
  ])
  hydrateForm()
})

watch(settings, () => {
  hydrateForm()
})

function hydrateForm() {
  if (!settings.value) return
  form.value = {
    sessionTimeoutMinutes: settings.value.sessionTimeoutMinutes,
    language: settings.value.language,
    heartbeatIntervalMinutes: settings.value.heartbeatIntervalMinutes,
    batchingDelayMs: settings.value.batchingDelayMs,
    telegramBotToken: settings.value.telegramBotToken,
    memoryConsolidation: { ...settings.value.memoryConsolidation },
  }
}

async function fetchConsolidationStatus() {
  try {
    consolidationStatus.value = await apiFetch<{
      lastRun: string | null
      lastResult: { updated: boolean; reason?: string } | null
    }>('/api/memory/consolidation/status')
  } catch {
    // Ignore - status display is optional
  }
}

async function handleRunConsolidation() {
  consolidationRunning.value = true
  try {
    const result = await apiFetch<{ updated: boolean; reason?: string }>('/api/memory/consolidation/run', {
      method: 'POST',
    })
    // Refresh status after run
    consolidationStatus.value = {
      lastRun: new Date().toISOString(),
      lastResult: result,
    }
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    consolidationRunning.value = false
  }
}

async function handleSave() {
  if (!form.value) return
  const success = await updateSettings(form.value)
  if (!success) return

  hydrateForm()
  setTimeout(() => {
    successMessage.value = null
  }, 3000)
}
</script>
