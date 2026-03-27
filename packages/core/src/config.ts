import fs from 'node:fs'
import path from 'node:path'

const TEMPLATES: Record<string, object> = {
  'providers.json': {
    providers: [],
    _comment: 'Add LLM provider configurations here. Each provider needs: name, type, baseUrl, apiKey, defaultModel',
  },
  'settings.json': {
    sessionTimeoutMinutes: 15,
    language: 'en',
    heartbeatIntervalMinutes: 5,
    yoloMode: true,
  },
  'telegram.json': {
    enabled: false,
    botToken: '',
    adminUserIds: [],
    pollingMode: true,
    webhookUrl: '',
    batchingDelayMs: 2500,
  },
}

export function getConfigDir(): string {
  return path.join(process.env.DATA_DIR ?? '/data', 'config')
}

export function loadConfig<T = unknown>(filename: string): T {
  const configDir = getConfigDir()
  const filePath = path.join(configDir, filename)

  if (!fs.existsSync(filePath)) {
    ensureConfigTemplates(configDir)
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  return JSON.parse(content) as T
}

export function ensureConfigTemplates(configDir?: string): void {
  const dir = configDir ?? getConfigDir()

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  for (const [filename, template] of Object.entries(TEMPLATES)) {
    const filePath = path.join(dir, filename)
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(template, null, 2) + '\n', 'utf-8')
    }
  }
}
