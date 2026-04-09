import { loadConfig, ensureConfigTemplates } from './config.js'
import { loadProvidersDecrypted, getApiKeyForProvider, PROVIDER_TYPE_PRESETS } from './provider-config.js'
import type { ProviderConfig } from './provider-config.js'

// ── Types ─────────────────────────────────────────────────────────────

export type SttProvider = 'whisper-url' | 'openai' | 'ollama'

export interface SttRewriteSettings {
  enabled: boolean
  providerId: string
}

export interface SttSettings {
  enabled: boolean
  provider: SttProvider
  whisperUrl: string
  providerId: string
  ollamaModel: string
  rewrite: SttRewriteSettings
}

export interface TranscribeResult {
  transcript: string
  rewritten?: string
}

export interface TranscribeOptions {
  language?: string
}

// ── Load settings ─────────────────────────────────────────────────────

export function loadSttSettings(): SttSettings {
  ensureConfigTemplates()
  const settings = loadConfig<Record<string, unknown>>('settings.json')
  const stt = (settings.stt ?? {}) as Partial<SttSettings>
  const rewrite = (stt.rewrite ?? {}) as Partial<SttRewriteSettings>
  return {
    enabled: stt.enabled ?? false,
    provider: stt.provider ?? 'whisper-url',
    whisperUrl: stt.whisperUrl ?? '',
    providerId: stt.providerId ?? '',
    ollamaModel: stt.ollamaModel ?? '',
    rewrite: {
      enabled: rewrite.enabled ?? false,
      providerId: rewrite.providerId ?? '',
    },
  }
}

// ── Whisper URL provider ──────────────────────────────────────────────

export async function transcribeWhisperUrl(
  buffer: Buffer,
  url: string,
  language?: string,
): Promise<string> {
  const formData = new FormData()
  formData.append('file', new Blob([buffer]), 'audio.webm')
  formData.append('response_format', 'text')
  if (language) {
    formData.append('language', language)
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      body: formData,
    })
  } catch (err) {
    throw new Error(`Whisper URL request failed: ${(err as Error).message}`)
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Whisper URL returned HTTP ${response.status}: ${errorText}`)
  }

  const text = await response.text()
  return text.trim()
}

// ── OpenAI Whisper provider ───────────────────────────────────────────

/**
 * Find the configured provider for STT by providerId.
 */
function findSttProvider(providerId: string): ProviderConfig | null {
  const file = loadProvidersDecrypted()
  return file.providers.find(p => p.id === providerId) ?? null
}

export async function transcribeOpenAi(
  buffer: Buffer,
  providerId: string,
  language?: string,
): Promise<string> {
  const provider = findSttProvider(providerId)
  if (!provider) {
    throw new Error(`OpenAI STT provider not found: ${providerId}. Check Settings → Speech-to-Text.`)
  }

  const apiKey = await getApiKeyForProvider(provider)
  const baseUrl = (provider.baseUrl || 'https://api.openai.com').replace(/\/+$/, '')
  const url = `${baseUrl}/v1/audio/transcriptions`

  const formData = new FormData()
  formData.append('file', new Blob([buffer]), 'audio.webm')
  formData.append('model', 'whisper-1')
  formData.append('response_format', 'text')
  if (language) {
    formData.append('language', language)
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    })
  } catch (err) {
    throw new Error(`OpenAI STT request failed: ${(err as Error).message}`)
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`OpenAI STT returned HTTP ${response.status}: ${errorText}`)
  }

  const text = await response.text()
  return text.trim()
}

// ── Ollama provider ───────────────────────────────────────────────────

export async function transcribeOllama(
  buffer: Buffer,
  providerId: string,
  model: string,
  language?: string,
): Promise<string> {
  const provider = findSttProvider(providerId)
  if (!provider) {
    throw new Error(`Ollama STT provider not found: ${providerId}. Check Settings → Speech-to-Text.`)
  }

  // Strip /v1 suffix to get Ollama's native base URL
  const rawBaseUrl = (provider.baseUrl || 'http://localhost:11434').replace(/\/+$/, '')
  const ollamaBase = rawBaseUrl.replace(/\/v1$/, '')
  const url = `${ollamaBase}/api/chat`

  const base64Audio = buffer.toString('base64')
  const effectiveModel = model || 'whisper'

  const prompt = language
    ? `Transcribe this audio. The language is ${language}. Return only the transcribed text, nothing else.`
    : 'Transcribe this audio. Return only the transcribed text, nothing else.'

  const body = {
    model: effectiveModel,
    messages: [
      {
        role: 'user',
        content: prompt,
        images: [base64Audio],
      },
    ],
    stream: false,
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new Error(`Ollama STT request failed: ${(err as Error).message}`)
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Ollama STT returned HTTP ${response.status}: ${errorText}`)
  }

  const data = await response.json() as { message?: { content?: string } }
  const transcript = data?.message?.content
  if (!transcript) {
    throw new Error('Ollama STT returned no transcript content.')
  }

  return transcript.trim()
}

// ── Rewrite ───────────────────────────────────────────────────────────

const REWRITE_SYSTEM_PROMPT = [
  'You are a transcript editor. Clean up the following dictated text.',
  '- Remove filler words (um, uh, like, you know, basically, well, so, etc.)',
  '- Remove false starts and repeated words or phrases',
  '- Fix grammar and punctuation',
  '- Preserve the complete meaning, intent, and tone',
  '- Do NOT add, summarize, or reinterpret the content',
  '- Output ONLY the cleaned text, nothing else',
].join('\n')

export async function rewriteTranscript(
  transcript: string,
  providerId: string,
): Promise<string> {
  const provider = findSttProvider(providerId)
  if (!provider) {
    throw new Error(`Rewrite provider not found: ${providerId}. Check Settings → Speech-to-Text.`)
  }

  const apiKey = await getApiKeyForProvider(provider)
  const preset = PROVIDER_TYPE_PRESETS[provider.providerType]
  const isAnthropic = preset?.apiType === 'anthropic-messages'

  if (isAnthropic) {
    return rewriteViaAnthropic(provider, apiKey, transcript)
  }
  return rewriteViaOpenAi(provider, apiKey, transcript)
}

async function rewriteViaOpenAi(
  provider: ProviderConfig,
  apiKey: string,
  transcript: string,
): Promise<string> {
  const baseUrl = (provider.baseUrl || 'https://api.openai.com').replace(/\/+$/, '')
  // Strip /v1 suffix for Ollama-type providers, then always append /v1/chat/completions
  const cleanBase = baseUrl.replace(/\/v1$/, '')
  const url = `${cleanBase}/v1/chat/completions`

  const body = {
    model: provider.defaultModel,
    messages: [
      { role: 'system', content: REWRITE_SYSTEM_PROMPT },
      { role: 'user', content: transcript },
    ],
    temperature: 0,
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new Error(`Rewrite request failed: ${(err as Error).message}`)
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Rewrite returned HTTP ${response.status}: ${errorText}`)
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data?.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('Rewrite returned no content.')
  }

  return content.trim()
}

async function rewriteViaAnthropic(
  provider: ProviderConfig,
  apiKey: string,
  transcript: string,
): Promise<string> {
  const baseUrl = (provider.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '')
  const url = `${baseUrl}/v1/messages`

  const body = {
    model: provider.defaultModel,
    max_tokens: 4096,
    system: REWRITE_SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: transcript },
    ],
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new Error(`Rewrite request failed: ${(err as Error).message}`)
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Rewrite returned HTTP ${response.status}: ${errorText}`)
  }

  const data = await response.json() as {
    content?: Array<{ type: string; text?: string }>
  }
  const textBlock = data?.content?.find(b => b.type === 'text')
  if (!textBlock?.text) {
    throw new Error('Rewrite returned no content.')
  }

  return textBlock.text.trim()
}

// ── Dispatcher ────────────────────────────────────────────────────────

export async function transcribeAudio(
  buffer: Buffer,
  options: TranscribeOptions = {},
): Promise<TranscribeResult> {
  const settings = loadSttSettings()

  if (!settings.enabled) {
    throw new Error('STT is not enabled. Enable it in Settings → Speech-to-Text.')
  }

  let transcript: string
  switch (settings.provider) {
    case 'whisper-url': {
      if (!settings.whisperUrl) {
        throw new Error('Whisper URL is not configured. Set it in Settings → Speech-to-Text.')
      }
      transcript = await transcribeWhisperUrl(buffer, settings.whisperUrl, options.language)
      break
    }
    case 'openai': {
      if (!settings.providerId) {
        throw new Error('OpenAI STT provider is not configured. Select a provider in Settings → Speech-to-Text.')
      }
      transcript = await transcribeOpenAi(buffer, settings.providerId, options.language)
      break
    }
    case 'ollama': {
      if (!settings.providerId) {
        throw new Error('Ollama STT provider is not configured. Select a provider in Settings → Speech-to-Text.')
      }
      transcript = await transcribeOllama(buffer, settings.providerId, settings.ollamaModel, options.language)
      break
    }
    default:
      throw new Error(`Unknown STT provider: ${settings.provider}`)
  }

  // Optional LLM-based rewriting
  if (settings.rewrite.enabled && settings.rewrite.providerId) {
    try {
      const rewritten = await rewriteTranscript(transcript, settings.rewrite.providerId)
      return { transcript, rewritten }
    } catch (err) {
      // Rewrite failure is non-fatal — return raw transcript
      console.warn(`[stt] Rewrite failed, returning raw transcript: ${(err as Error).message}`)
      return { transcript }
    }
  }

  return { transcript }
}
