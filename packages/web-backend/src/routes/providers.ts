import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import { URL } from 'node:url'
import { Router } from 'express'
import {
  loadProviders,
  loadProvidersMasked,
  loadProvidersDecrypted,
  addProvider,
  addOAuthProvider,
  updateProvider,
  deleteProvider,
  setActiveProvider,
  setActiveModel,
  getActiveModelId,
  updateProviderStatus,
  getAvailableModels,
  buildModel,
  PROVIDER_TYPE_PRESETS,
  performProviderHealthCheck,
  getFallbackProvider,
  getFallbackModelId,
  setFallbackProvider,
  clearFallbackProvider,
  updateOAuthCredentials,
} from '@openagent/core'
import { getModels as getPiAiModels } from '@mariozechner/pi-ai'
import type { KnownProvider as PiAiKnownProvider } from '@mariozechner/pi-ai'
import type { ProviderConfig, ProviderType } from '@openagent/core'
import { getOAuthProvider } from '@mariozechner/pi-ai/oauth'
import type { OAuthCredentials } from '@mariozechner/pi-ai/oauth'
import { jwtMiddleware } from '../auth.js'
import type { AuthenticatedRequest } from '../auth.js'

const VALID_PROVIDER_TYPES = Object.keys(PROVIDER_TYPE_PRESETS)

/** Timeout for non-streaming Ollama requests (tags, delete) */
const OLLAMA_REQUEST_TIMEOUT_MS = 15_000

/**
 * Validate that a URL does not point to private/internal network addresses.
 * For `ollama-local` providers, localhost/loopback is explicitly allowed.
 * Rejects link-local, cloud metadata, and RFC-1918 ranges for `ollama-cloud`.
 */
async function validateOllamaUrl(urlStr: string, providerType: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(urlStr)
  } catch {
    throw new Error('Invalid Ollama base URL')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http/https URLs are allowed')
  }

  const hostname = parsed.hostname

  // For ollama-local, allow loopback — that's the whole point
  if (providerType === 'ollama-local') return

  // For ollama-cloud, resolve DNS and reject private ranges
  const isIpLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith('[')
  const addresses = isIpLiteral ? [hostname.replace(/^\[|\]$/g, '')] : (await dns.resolve4(hostname).catch(() => []))

  for (const addr of addresses) {
    if (isPrivateOrReserved(addr)) {
      throw new Error(`URL resolves to a private/reserved address (${addr})`)
    }
  }
}

function isPrivateOrReserved(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4) return false
  const [a, b] = parts
  // Loopback 127.0.0.0/8
  if (a === 127) return true
  // Link-local 169.254.0.0/16 (cloud metadata)
  if (a === 169 && b === 254) return true
  // RFC-1918
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  // 0.0.0.0
  if (a === 0) return true
  return false
}

export interface ProvidersRouterOptions {
  onActiveProviderChanged?: () => void
  onFallbackProviderChanged?: () => void
}

/**
 * In-memory state for pending OAuth login flows
 */
interface PendingOAuthLogin {
  status: 'pending' | 'completed' | 'error'
  providerType: string
  name: string
  defaultModel: string
  authUrl?: string
  instructions?: string
  credentials?: OAuthCredentials
  error?: string
  resolveManualCode?: (code: string) => void
  createdAt: number
  /** When set, this is a token renewal for an existing provider */
  existingProviderId?: string
}

const pendingOAuthLogins = new Map<string, PendingOAuthLogin>()

// Clean up stale logins older than 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000
  for (const [id, login] of pendingOAuthLogins) {
    if (login.createdAt < cutoff) {
      pendingOAuthLogins.delete(id)
    }
  }
}, 60 * 1000)

export function createProvidersRouter(options: ProvidersRouterOptions = {}): Router {
  const router = Router()

  // All provider routes require admin JWT
  router.use(jwtMiddleware)
  router.use((req: AuthenticatedRequest, res, next) => {
    if (req.user?.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required' })
      return
    }
    next()
  })

  /**
   * PUT /api/providers/fallback
   * Set or clear the fallback provider
   */
  router.put('/fallback', (req: AuthenticatedRequest, res) => {
    const { providerId, modelId } = req.body as { providerId?: string | null; modelId?: string | null }

    try {
      if (providerId === null || providerId === undefined) {
        clearFallbackProvider()
        options.onFallbackProviderChanged?.()
        res.json({ message: 'Fallback provider cleared', fallbackProvider: null, fallbackModel: null })
        return
      }

      if (typeof providerId !== 'string' || !providerId.trim()) {
        res.status(400).json({ error: 'providerId must be a non-empty string or null' })
        return
      }

      setFallbackProvider(providerId, modelId ?? undefined)
      options.onFallbackProviderChanged?.()
      const fbModelId = getFallbackModelId()
      res.json({ message: 'Fallback set', fallbackProvider: providerId, fallbackModel: fbModelId })
    } catch (err) {
      const message = (err as Error).message
      if (message.includes('not found')) {
        res.status(404).json({ error: message })
      } else {
        res.status(400).json({ error: message })
      }
    }
  })

  /**
   * GET /api/providers
   * List all providers with masked API keys
   */
  router.get('/', (_req: AuthenticatedRequest, res) => {
    try {
      const data = loadProvidersMasked()
      const decrypted = loadProvidersDecrypted()
      const providersWithCost = data.providers.map(p => {
        const full = decrypted.providers.find(d => d.id === p.id)
        let cost: { input: number; output: number } | null = null
        const modelCosts: Record<string, { input: number; output: number }> = {}

        if (full) {
          // Helper: resolve cost for a single model ID
          const resolveCost = (modelId: string): { input: number; output: number } | null => {
            try {
              const m = buildModel(full, modelId)
              if (m.cost.input > 0 || m.cost.output > 0) {
                return { input: m.cost.input, output: m.cost.output }
              }
            } catch { /* ignore */ }

            // Fallback: look up cost directly from pi-ai model registry
            const preset = PROVIDER_TYPE_PRESETS[full.providerType as ProviderType]
            if (preset?.piAiProvider) {
              try {
                const piModels = getPiAiModels(preset.piAiProvider as PiAiKnownProvider)
                const match = piModels.find(m => m.id === modelId)
                if (match && (match.cost.input > 0 || match.cost.output > 0)) {
                  return { input: match.cost.input, output: match.cost.output }
                }
              } catch { /* ignore */ }
            }
            return null
          }

          // Default model cost (shown on provider row for single-model providers)
          cost = resolveCost(full.defaultModel)

          // Per-model costs for all enabled models
          const enabledModels = full.enabledModels ?? [full.defaultModel]
          for (const modelId of enabledModels) {
            const mc = resolveCost(modelId)
            if (mc) modelCosts[modelId] = mc
          }
        }
        return { ...p, cost, modelCosts }
      })
      res.json({
        providers: providersWithCost,
        activeProvider: data.activeProvider ?? null,
        activeModel: data.activeModel ?? null,
        fallbackProvider: data.fallbackProvider ?? null,
        fallbackModel: data.fallbackModel ?? null,
        presets: PROVIDER_TYPE_PRESETS,
      })
    } catch (err) {
      res.status(500).json({ error: `Failed to load providers: ${(err as Error).message}` })
    }
  })

  /**
   * GET /api/providers/models/:providerType
   * Get available models for a provider type from pi-ai
   */
  router.get('/models/:providerType', (_req: AuthenticatedRequest, res) => {
    const providerType = _req.params.providerType as string

    if (!VALID_PROVIDER_TYPES.includes(providerType)) {
      res.status(400).json({ error: `Invalid provider type. Must be one of: ${VALID_PROVIDER_TYPES.join(', ')}` })
      return
    }

    try {
      const models = getAvailableModels(providerType as ProviderType)
      res.json({ models })
    } catch (err) {
      res.status(500).json({ error: `Failed to get models: ${(err as Error).message}` })
    }
  })

  /**
   * POST /api/providers/oauth/login
   * Start an OAuth login flow for a subscription provider
   */
  router.post('/oauth/login', async (req: AuthenticatedRequest, res) => {
    const { providerType, name, defaultModel, providerId } = req.body as {
      providerType?: string
      name?: string
      defaultModel?: string
      providerId?: string
    }

    if (!providerType || !VALID_PROVIDER_TYPES.includes(providerType)) {
      res.status(400).json({ error: 'Invalid provider type' })
      return
    }
    if (!name?.trim()) {
      res.status(400).json({ error: 'Provider name is required' })
      return
    }
    if (!defaultModel?.trim()) {
      res.status(400).json({ error: 'Default model is required' })
      return
    }

    const preset = PROVIDER_TYPE_PRESETS[providerType as ProviderType]
    if (preset.authMethod !== 'oauth' || !preset.oauthProviderId) {
      res.status(400).json({ error: 'This provider type does not use OAuth' })
      return
    }

    const oauthProvider = getOAuthProvider(preset.oauthProviderId)
    if (!oauthProvider) {
      res.status(400).json({ error: `OAuth provider "${preset.oauthProviderId}" not found` })
      return
    }

    const loginId = crypto.randomUUID()
    const loginState: PendingOAuthLogin = {
      status: 'pending',
      providerType,
      name: name.trim(),
      defaultModel: defaultModel.trim(),
      createdAt: Date.now(),
      existingProviderId: providerId,
    }
    pendingOAuthLogins.set(loginId, loginState)

    // Promise that resolves when onAuth is called
    let resolveAuthInfo: (info: { url: string; instructions?: string }) => void
    const authInfoPromise = new Promise<{ url: string; instructions?: string }>((resolve) => {
      resolveAuthInfo = resolve
    })

    // Start login flow in background
    oauthProvider.login({
      onAuth: (info) => {
        loginState.authUrl = info.url
        loginState.instructions = info.instructions
        resolveAuthInfo!(info)
      },
      onPrompt: async (prompt) => {
        // Use defaults for prompts (e.g., GitHub Enterprise domain → github.com)
        if (prompt.allowEmpty) return ''
        return prompt.placeholder ?? ''
      },
      onProgress: () => {},
      onManualCodeInput: oauthProvider.usesCallbackServer
        ? () => new Promise<string>((resolve) => {
            loginState.resolveManualCode = resolve
          })
        : undefined,
    }).then(credentials => {
      loginState.status = 'completed'
      loginState.credentials = credentials
    }).catch(err => {
      loginState.status = 'error'
      loginState.error = (err as Error).message
      // Resolve authInfo if it hasn't been resolved yet (error before onAuth)
      resolveAuthInfo!({ url: '', instructions: '' })
    })

    // Wait for auth URL (or error)
    const authInfo = await authInfoPromise

    if (loginState.status === 'error') {
      pendingOAuthLogins.delete(loginId)
      res.status(500).json({ error: loginState.error ?? 'OAuth login failed' })
      return
    }

    res.json({
      loginId,
      authUrl: authInfo.url,
      instructions: authInfo.instructions,
      usesCallbackServer: oauthProvider.usesCallbackServer ?? false,
    })
  })

  /**
   * GET /api/providers/oauth/status/:loginId
   * Poll for OAuth login completion
   */
  router.get('/oauth/status/:loginId', (req: AuthenticatedRequest, res) => {
    const loginId = req.params.loginId as string
    const loginState = pendingOAuthLogins.get(loginId)
    if (!loginState) {
      res.status(404).json({ error: 'Login session not found or expired' })
      return
    }

    if (loginState.status === 'completed' && loginState.credentials) {
      try {
        let provider: ProviderConfig

        if (loginState.existingProviderId) {
          // Token renewal: update credentials on existing provider
          updateOAuthCredentials(loginState.existingProviderId, loginState.credentials)
          const file = loadProviders()
          provider = file.providers.find(p => p.id === loginState.existingProviderId)!
        } else {
          // New provider creation
          const beforeActiveProvider = loadProviders().activeProvider ?? null
          provider = addOAuthProvider({
            name: loginState.name,
            providerType: loginState.providerType as ProviderType,
            defaultModel: loginState.defaultModel,
            oauthCredentials: loginState.credentials,
          })
          const afterActiveProvider = loadProviders().activeProvider ?? null

          if (beforeActiveProvider !== afterActiveProvider) {
            options.onActiveProviderChanged?.()
          }
        }

        pendingOAuthLogins.delete(loginId)
        res.json({
          status: 'completed',
          provider: { ...provider, apiKey: '', apiKeyMasked: '' },
        })
      } catch (err) {
        res.status(400).json({ status: 'error', error: (err as Error).message })
      }
      return
    }

    if (loginState.status === 'error') {
      pendingOAuthLogins.delete(loginId)
      res.json({ status: 'error', error: loginState.error })
      return
    }

    res.json({ status: 'pending' })
  })

  /**
   * POST /api/providers/oauth/code/:loginId
   * Submit manual OAuth code (fallback for remote servers)
   */
  router.post('/oauth/code/:loginId', (req: AuthenticatedRequest, res) => {
    const codeLoginId = req.params.loginId as string
    const loginState = pendingOAuthLogins.get(codeLoginId)
    if (!loginState) {
      res.status(404).json({ error: 'Login session not found or expired' })
      return
    }

    const { code } = req.body as { code?: string }
    if (!code?.trim()) {
      res.status(400).json({ error: 'Code is required' })
      return
    }

    if (loginState.resolveManualCode) {
      loginState.resolveManualCode(code.trim())
      res.json({ status: 'pending', message: 'Code submitted, processing...' })
    } else {
      res.status(400).json({ error: 'This login flow does not accept manual code input' })
    }
  })

  /**
   * POST /api/providers
   * Add a new provider
   */
  router.post('/', (req: AuthenticatedRequest, res) => {
    const { name, providerType, baseUrl, apiKey, defaultModel, enabledModels, degradedThresholdMs } = req.body as {
      name?: string
      providerType?: string
      baseUrl?: string
      apiKey?: string
      defaultModel?: string
      enabledModels?: string[]
      degradedThresholdMs?: number
    }

    if (!name?.trim()) {
      res.status(400).json({ error: 'Provider name is required' })
      return
    }
    if (!providerType || !VALID_PROVIDER_TYPES.includes(providerType)) {
      res.status(400).json({ error: `Invalid provider type. Must be one of: ${VALID_PROVIDER_TYPES.join(', ')}` })
      return
    }
    if (!defaultModel?.trim()) {
      res.status(400).json({ error: 'Default model is required' })
      return
    }

    const preset = PROVIDER_TYPE_PRESETS[providerType as ProviderType]
    if (preset.requiresApiKey && !apiKey?.trim()) {
      res.status(400).json({ error: 'API key is required for this provider type' })
      return
    }

    try {
      const beforeActiveProvider = loadProviders().activeProvider ?? null
      const provider = addProvider({
        name: name.trim(),
        providerType: providerType as ProviderType,
        baseUrl: baseUrl?.trim(),
        apiKey: apiKey?.trim(),
        defaultModel: defaultModel.trim(),
        enabledModels: enabledModels?.map(m => m.trim()).filter(Boolean),
        degradedThresholdMs: degradedThresholdMs != null ? Math.max(1, Math.round(degradedThresholdMs)) : undefined,
      })
      const afterActiveProvider = loadProviders().activeProvider ?? null

      if (beforeActiveProvider !== afterActiveProvider) {
        options.onActiveProviderChanged?.()
      }

      res.status(201).json({
        provider: {
          ...provider,
          apiKey: '',
          apiKeyMasked: apiKey ? `${apiKey.slice(0, 4)}••••••••${apiKey.slice(-4)}` : '',
        },
      })
    } catch (err) {
      res.status(400).json({ error: (err as Error).message })
    }
  })

  /**
   * POST /api/providers/ollama-probe
   * Probe an Ollama instance by base URL (for create-mode, before a provider exists).
   * Body: { baseUrl: string, providerType: 'ollama-local' | 'ollama-cloud' }
   */
  router.post('/ollama-probe', async (req: AuthenticatedRequest, res) => {
    const { baseUrl, providerType } = req.body as { baseUrl?: string; providerType?: string }

    if (!providerType || (providerType !== 'ollama-local' && providerType !== 'ollama-cloud')) {
      res.status(400).json({ error: 'providerType must be ollama-local or ollama-cloud' })
      return
    }

    try {
      let ollamaBase = (baseUrl || 'http://localhost:11434').replace(/\/v1\/?$/, '').replace(/\/$/, '')

      await validateOllamaUrl(ollamaBase, providerType)

      const tagsResp = await fetch(`${ollamaBase}/api/tags`, {
        signal: AbortSignal.timeout(OLLAMA_REQUEST_TIMEOUT_MS),
      })
      if (!tagsResp.ok) {
        throw new Error(`Ollama returned HTTP ${tagsResp.status}`)
      }
      const tagsData = await tagsResp.json() as {
        models?: Array<{
          name: string
          size: number
          details?: {
            parameter_size?: string
            quantization_level?: string
            family?: string
          }
        }>
      }

      const models = (tagsData.models ?? []).map(m => ({
        name: m.name,
        size: m.size,
        parameterSize: m.details?.parameter_size ?? '',
        quantization: m.details?.quantization_level ?? '',
        family: m.details?.family ?? '',
      }))

      res.json({ models })
    } catch (err) {
      res.status(502).json({ error: `Failed to reach Ollama API: ${(err as Error).message}` })
    }
  })

  /**
   * POST /api/providers/ollama-probe/pull
   * Pull a model via Ollama base URL (for create-mode, before a provider exists).
   * Body: { baseUrl: string, providerType: 'ollama-local' | 'ollama-cloud', modelName: string }
   */
  router.post('/ollama-probe/pull', async (req: AuthenticatedRequest, res) => {
    const { baseUrl, providerType, modelName } = req.body as { baseUrl?: string; providerType?: string; modelName?: string }

    if (!providerType || (providerType !== 'ollama-local' && providerType !== 'ollama-cloud')) {
      res.status(400).json({ error: 'providerType must be ollama-local or ollama-cloud' })
      return
    }
    if (!modelName?.trim()) {
      res.status(400).json({ error: 'modelName is required' })
      return
    }

    try {
      let ollamaBase = (baseUrl || 'http://localhost:11434').replace(/\/v1\/?$/, '').replace(/\/$/, '')

      await validateOllamaUrl(ollamaBase, providerType)

      const ac = new AbortController()
      req.on('close', () => ac.abort())

      const pullResp = await fetch(`${ollamaBase}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName.trim(), stream: true }),
        signal: ac.signal,
      })

      if (!pullResp.ok) {
        const errText = await pullResp.text().catch(() => '')
        res.status(502).json({ error: `Ollama pull failed: HTTP ${pullResp.status} ${errText}` })
        return
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      res.flushHeaders()

      const reader = pullResp.body?.getReader()
      if (!reader) {
        res.write(`data: ${JSON.stringify({ error: 'No response body from Ollama' })}\n\n`)
        res.end()
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const event = JSON.parse(line)
              res.write(`data: ${JSON.stringify(event)}\n\n`)
              if (typeof (res as any).flush === 'function') (res as any).flush()
            } catch (parseErr) {
              console.warn(`[ollama-probe-pull] Skipping malformed NDJSON line: ${line.substring(0, 200)}`)
            }
          }
        }
        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer)
            res.write(`data: ${JSON.stringify(event)}\n\n`)
          } catch (parseErr) {
            console.warn(`[ollama-probe-pull] Skipping malformed trailing NDJSON: ${buffer.substring(0, 200)}`)
          }
        }
      } finally {
        reader.releaseLock()
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`)
      res.end()
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        if (!res.writableEnded) res.end()
        return
      }
      if (!res.headersSent) {
        res.status(502).json({ error: `Failed to pull model: ${(err as Error).message}` })
      } else {
        res.write(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`)
        res.end()
      }
    }
  })

  /**
   * GET /api/providers/:id/ollama-models
   * Fetch installed models from an Ollama instance.
   * Only works for ollama-local / ollama-cloud providers.
   */
  router.get('/:id/ollama-models', async (req: AuthenticatedRequest, res) => {
    const id = req.params.id as string

    try {
      const data = loadProvidersDecrypted()
      const provider = data.providers.find(p => p.id === id)
      if (!provider) {
        res.status(404).json({ error: 'Provider not found' })
        return
      }

      const isOllama = provider.providerType === 'ollama-local' || provider.providerType === 'ollama-cloud'
      if (!isOllama) {
        res.status(400).json({ error: 'Not an Ollama provider' })
        return
      }

      // Derive Ollama base URL (strip /v1 suffix used for OpenAI compat)
      let ollamaBase = provider.baseUrl || 'http://localhost:11434'
      ollamaBase = ollamaBase.replace(/\/v1\/?$/, '').replace(/\/$/, '')

      await validateOllamaUrl(ollamaBase, provider.providerType)

      const tagsResp = await fetch(`${ollamaBase}/api/tags`, {
        signal: AbortSignal.timeout(OLLAMA_REQUEST_TIMEOUT_MS),
      })
      if (!tagsResp.ok) {
        throw new Error(`Ollama returned HTTP ${tagsResp.status}`)
      }
      const tagsData = await tagsResp.json() as {
        models?: Array<{
          name: string
          size: number
          details?: {
            parameter_size?: string
            quantization_level?: string
            family?: string
          }
        }>
      }

      const models = (tagsData.models ?? []).map(m => ({
        name: m.name,
        size: m.size,
        parameterSize: m.details?.parameter_size ?? '',
        quantization: m.details?.quantization_level ?? '',
        family: m.details?.family ?? '',
      }))

      res.json({ models })
    } catch (err) {
      res.status(502).json({ error: `Failed to reach Ollama API: ${(err as Error).message}` })
    }
  })

  /**
   * POST /api/providers/:id/ollama-pull
   * Pull (download) a model from the Ollama library.
   * Streams progress events as SSE (Server-Sent Events).
   */
  router.post('/:id/ollama-pull', async (req: AuthenticatedRequest, res) => {
    const id = req.params.id as string
    const { modelName } = req.body as { modelName?: string }

    if (!modelName?.trim()) {
      res.status(400).json({ error: 'modelName is required' })
      return
    }

    try {
      const data = loadProvidersDecrypted()
      const provider = data.providers.find(p => p.id === id)
      if (!provider) {
        res.status(404).json({ error: 'Provider not found' })
        return
      }

      const isOllama = provider.providerType === 'ollama-local' || provider.providerType === 'ollama-cloud'
      if (!isOllama) {
        res.status(400).json({ error: 'Not an Ollama provider' })
        return
      }

      let ollamaBase = provider.baseUrl || 'http://localhost:11434'
      ollamaBase = ollamaBase.replace(/\/v1\/?$/, '').replace(/\/$/, '')

      await validateOllamaUrl(ollamaBase, provider.providerType)

      // Abort the Ollama fetch when the client disconnects
      const ac = new AbortController()
      req.on('close', () => ac.abort())

      // Start pull with streaming
      const pullResp = await fetch(`${ollamaBase}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName.trim(), stream: true }),
        signal: ac.signal,
      })

      if (!pullResp.ok) {
        const errText = await pullResp.text().catch(() => '')
        res.status(502).json({ error: `Ollama pull failed: HTTP ${pullResp.status} ${errText}` })
        return
      }

      // Stream SSE to client
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      res.flushHeaders()

      const reader = pullResp.body?.getReader()
      if (!reader) {
        res.write(`data: ${JSON.stringify({ error: 'No response body from Ollama' })}\n\n`)
        res.end()
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? '' // keep incomplete line in buffer

          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const event = JSON.parse(line) as {
                status?: string
                total?: number
                completed?: number
                error?: string
              }
              res.write(`data: ${JSON.stringify(event)}\n\n`)
              if (typeof (res as any).flush === 'function') (res as any).flush()
            } catch (parseErr) {
              console.warn(`[ollama-pull] Skipping malformed NDJSON line: ${line.substring(0, 200)}`)
            }
          }
        }

        // Process any remaining buffer
        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer)
            res.write(`data: ${JSON.stringify(event)}\n\n`)
          } catch (parseErr) {
            console.warn(`[ollama-pull] Skipping malformed trailing NDJSON: ${buffer.substring(0, 200)}`)
          }
        }
      } finally {
        reader.releaseLock()
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`)
      res.end()
    } catch (err) {
      // If aborted due to client disconnect, just clean up silently
      if ((err as Error).name === 'AbortError') {
        if (!res.writableEnded) res.end()
        return
      }
      if (!res.headersSent) {
        res.status(502).json({ error: `Failed to pull model: ${(err as Error).message}` })
      } else {
        res.write(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`)
        res.end()
      }
    }
  })

  /**
   * DELETE /api/providers/:id/ollama-models/:modelName
   * Delete a model from the Ollama instance.
   */
  router.delete('/:id/ollama-models/:modelName', async (req: AuthenticatedRequest, res) => {
    const id = req.params.id as string
    const modelName = req.params.modelName as string

    try {
      const data = loadProvidersDecrypted()
      const provider = data.providers.find(p => p.id === id)
      if (!provider) {
        res.status(404).json({ error: 'Provider not found' })
        return
      }

      const isOllama = provider.providerType === 'ollama-local' || provider.providerType === 'ollama-cloud'
      if (!isOllama) {
        res.status(400).json({ error: 'Not an Ollama provider' })
        return
      }

      let ollamaBase = provider.baseUrl || 'http://localhost:11434'
      ollamaBase = ollamaBase.replace(/\/v1\/?$/, '').replace(/\/$/, '')

      await validateOllamaUrl(ollamaBase, provider.providerType)

      const delResp = await fetch(`${ollamaBase}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName }),
        signal: AbortSignal.timeout(OLLAMA_REQUEST_TIMEOUT_MS),
      })

      if (!delResp.ok) {
        const errText = await delResp.text().catch(() => '')
        res.status(502).json({ error: `Ollama delete failed: HTTP ${delResp.status} ${errText}` })
        return
      }

      res.json({ message: `Model ${modelName} deleted` })
    } catch (err) {
      res.status(502).json({ error: `Failed to delete model: ${(err as Error).message}` })
    }
  })

  /**
   * PUT /api/providers/:id
   * Update a provider
   */
  router.put('/:id', (req: AuthenticatedRequest, res) => {
    const id = req.params.id as string
    const { name, providerType, baseUrl, apiKey, defaultModel, enabledModels, degradedThresholdMs } = req.body as {
      name?: string
      providerType?: string
      baseUrl?: string
      apiKey?: string
      defaultModel?: string
      enabledModels?: string[]
      degradedThresholdMs?: number
    }

    if (providerType && !VALID_PROVIDER_TYPES.includes(providerType)) {
      res.status(400).json({ error: `Invalid provider type. Must be one of: ${VALID_PROVIDER_TYPES.join(', ')}` })
      return
    }

    try {
      const activeProvider = loadProviders().activeProvider ?? null
      const provider = updateProvider(id, {
        name: name?.trim(),
        providerType: providerType as ProviderType | undefined,
        baseUrl: baseUrl?.trim(),
        apiKey: apiKey?.trim(),
        defaultModel: defaultModel?.trim(),
        enabledModels: enabledModels?.map(m => m.trim()).filter(Boolean),
        degradedThresholdMs: degradedThresholdMs != null ? Math.max(1, Math.round(degradedThresholdMs)) : undefined,
      })

      if (activeProvider === id) {
        options.onActiveProviderChanged?.()
      }

      res.json({
        provider: {
          ...provider,
          apiKey: '',
          apiKeyMasked: apiKey ? `${apiKey.slice(0, 4)}••••••••${apiKey.slice(-4)}` : '(unchanged)',
        },
      })
    } catch (err) {
      const message = (err as Error).message
      if (message.includes('not found')) {
        res.status(404).json({ error: message })
      } else {
        res.status(400).json({ error: message })
      }
    }
  })

  /**
   * DELETE /api/providers/:id
   * Remove a provider
   */
  router.delete('/:id', (req: AuthenticatedRequest, res) => {
    const id = req.params.id as string

    try {
      deleteProvider(id)
      res.json({ message: 'Provider deleted' })
    } catch (err) {
      const message = (err as Error).message
      if (message.includes('not found')) {
        res.status(404).json({ error: message })
      } else {
        res.status(400).json({ error: message })
      }
    }
  })

  /**
   * POST /api/providers/:id/test
   * Test provider connectivity
   */
  router.post('/:id/test', async (req: AuthenticatedRequest, res) => {
    const id = req.params.id as string
    const { modelId } = (req.body ?? {}) as { modelId?: string }

    try {
      const data = loadProvidersDecrypted()
      const provider = data.providers.find(p => p.id === id)
      if (!provider) {
        res.status(404).json({ error: 'Provider not found' })
        return
      }

      // If a specific model is requested, temporarily override defaultModel for the health check
      const testProvider = modelId ? { ...provider, defaultModel: modelId } : provider
      const testModelId = modelId ?? provider.defaultModel

      const result = await performProviderHealthCheck(testProvider)
      const status = result.status === 'down' ? 'error' : 'connected'
      updateProviderStatus(id, status, modelId)

      if (result.status === 'down') {
        res.status(200).json({ success: false, error: result.errorMessage ?? 'Connection failed', modelId: testModelId })
        return
      }

      res.json({
        success: true,
        message: result.status === 'degraded'
          ? `Connected, but slow response (${result.latencyMs}ms)`
          : `Connected successfully. Model: ${testModelId}`,
        latencyMs: result.latencyMs,
        status: result.status,
        modelId: testModelId,
      })
    } catch (err) {
      res.status(500).json({ success: false, error: `Test failed: ${(err as Error).message}` })
    }
  })

  /**
   * POST /api/providers/:id/activate
   * Set a provider as the active provider
   */
  router.post('/:id/activate', (req: AuthenticatedRequest, res) => {
    const id = req.params.id as string
    const { modelId } = (req.body ?? {}) as { modelId?: string }

    try {
      const before = loadProviders()
      const beforeActiveProvider = before.activeProvider ?? null
      const beforeActiveModel = before.activeModel ?? null
      setActiveProvider(id, modelId ?? undefined)
      const after = loadProviders()
      const afterActiveProvider = after.activeProvider ?? null
      const afterActiveModel = after.activeModel ?? null

      if (beforeActiveProvider !== afterActiveProvider || beforeActiveModel !== afterActiveModel) {
        options.onActiveProviderChanged?.()
      }

      res.json({ message: 'Provider activated', activeProvider: id, activeModel: afterActiveModel })
    } catch (err) {
      const message = (err as Error).message
      if (message.includes('not found')) {
        res.status(404).json({ error: message })
      } else {
        res.status(400).json({ error: message })
      }
    }
  })

  return router
}
