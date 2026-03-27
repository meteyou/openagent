import { Router } from 'express'
import {
  loadProvidersMasked,
  loadProvidersDecrypted,
  addProvider,
  updateProvider,
  deleteProvider,
  setActiveProvider,
  updateProviderStatus,
  PROVIDER_TYPE_PRESETS,
} from '@openagent/core'
import type { ProviderType } from '@openagent/core'
import { jwtMiddleware } from '../auth.js'
import type { AuthenticatedRequest } from '../auth.js'

const VALID_PROVIDER_TYPES = Object.keys(PROVIDER_TYPE_PRESETS)

export function createProvidersRouter(): Router {
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
   * GET /api/providers
   * List all providers with masked API keys
   */
  router.get('/', (_req: AuthenticatedRequest, res) => {
    try {
      const data = loadProvidersMasked()
      res.json({
        providers: data.providers,
        activeProvider: data.activeProvider ?? null,
        presets: PROVIDER_TYPE_PRESETS,
      })
    } catch (err) {
      res.status(500).json({ error: `Failed to load providers: ${(err as Error).message}` })
    }
  })

  /**
   * POST /api/providers
   * Add a new provider
   */
  router.post('/', (req: AuthenticatedRequest, res) => {
    const { name, providerType, baseUrl, apiKey, defaultModel } = req.body as {
      name?: string
      providerType?: string
      baseUrl?: string
      apiKey?: string
      defaultModel?: string
    }

    // Validate required fields
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

    // Check if API key is required for this provider type
    const preset = PROVIDER_TYPE_PRESETS[providerType as ProviderType]
    if (preset.requiresApiKey && !apiKey?.trim()) {
      res.status(400).json({ error: 'API key is required for this provider type' })
      return
    }

    try {
      const provider = addProvider({
        name: name.trim(),
        providerType: providerType as ProviderType,
        baseUrl: baseUrl?.trim(),
        apiKey: apiKey?.trim(),
        defaultModel: defaultModel.trim(),
      })

      res.status(201).json({
        provider: {
          ...provider,
          apiKey: '', // Don't return the encrypted key
          apiKeyMasked: apiKey ? `${apiKey.slice(0, 4)}••••••••${apiKey.slice(-4)}` : '',
        },
      })
    } catch (err) {
      res.status(400).json({ error: (err as Error).message })
    }
  })

  /**
   * PUT /api/providers/:id
   * Update a provider
   */
  router.put('/:id', (req: AuthenticatedRequest, res) => {
    const id = req.params.id as string
    const { name, providerType, baseUrl, apiKey, defaultModel } = req.body as {
      name?: string
      providerType?: string
      baseUrl?: string
      apiKey?: string
      defaultModel?: string
    }

    // Validate providerType if provided
    if (providerType && !VALID_PROVIDER_TYPES.includes(providerType)) {
      res.status(400).json({ error: `Invalid provider type. Must be one of: ${VALID_PROVIDER_TYPES.join(', ')}` })
      return
    }

    try {
      const provider = updateProvider(id, {
        name: name?.trim(),
        providerType: providerType as ProviderType | undefined,
        baseUrl: baseUrl?.trim(),
        apiKey: apiKey?.trim(),
        defaultModel: defaultModel?.trim(),
      })

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

    try {
      const data = loadProvidersDecrypted()
      const provider = data.providers.find(p => p.id === id)
      if (!provider) {
        res.status(404).json({ error: 'Provider not found' })
        return
      }

      // Build a minimal test request based on provider type
      const result = await testProviderConnection(provider)

      // Update status in config
      updateProviderStatus(id, result.success ? 'connected' : 'error')

      if (result.success) {
        res.json({ success: true, message: result.message })
      } else {
        res.status(200).json({ success: false, error: result.error })
      }
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

    try {
      setActiveProvider(id)
      res.json({ message: 'Provider activated', activeProvider: id })
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

/**
 * Test a provider connection by sending a minimal API request
 */
async function testProviderConnection(provider: {
  type: string
  baseUrl: string
  apiKey: string
  defaultModel: string
  providerType?: string
}): Promise<{ success: boolean; message?: string; error?: string }> {
  const timeout = 15000

  try {
    if (provider.type === 'anthropic-messages') {
      // Anthropic API test
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)

      const response = await fetch(`${provider.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': provider.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: provider.defaultModel,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
        signal: controller.signal,
      })

      clearTimeout(timer)

      if (response.ok) {
        return { success: true, message: `Connected to Anthropic. Model: ${provider.defaultModel}` }
      }

      const body = await response.json().catch(() => ({})) as { error?: { message?: string } }
      return { success: false, error: body.error?.message || `HTTP ${response.status}` }
    } else {
      // OpenAI-compatible API test (covers openai, ollama, kimi, zai)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (provider.apiKey) {
        headers['Authorization'] = `Bearer ${provider.apiKey}`
      }

      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: provider.defaultModel,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
        signal: controller.signal,
      })

      clearTimeout(timer)

      if (response.ok) {
        return { success: true, message: `Connected successfully. Model: ${provider.defaultModel}` }
      }

      const body = await response.json().catch(() => ({})) as { error?: { message?: string } }
      return { success: false, error: body.error?.message || `HTTP ${response.status}` }
    }
  } catch (err) {
    const message = (err as Error).message
    if (message.includes('abort')) {
      return { success: false, error: 'Connection timed out' }
    }
    if (message.includes('ECONNREFUSED')) {
      return { success: false, error: 'Connection refused. Is the service running?' }
    }
    return { success: false, error: message }
  }
}
