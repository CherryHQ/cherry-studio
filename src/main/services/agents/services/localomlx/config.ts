import fs from 'fs'
import { homedir } from 'os'
import path from 'path'

export type LocalOmlxConfig = {
  baseUrl: string
  chatUrl: string
  apiKey: string
  source: string
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000'

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

export function readLocalOmlxConfig(): LocalOmlxConfig {
  const envBaseUrl = process.env.OMLX_BASE_URL || process.env.OMLX_API_BASE_URL
  const envApiUrl = process.env.OMLX_API_URL
  const envApiKey = process.env.OMLX_API_KEY

  if (envApiKey) {
    const baseUrl = normalizeBaseUrl(envBaseUrl || DEFAULT_BASE_URL)
    return {
      baseUrl,
      chatUrl: envApiUrl || `${baseUrl}/v1/chat/completions`,
      apiKey: envApiKey,
      source: 'environment'
    }
  }

  const settingsPath = process.env.OMLX_SETTINGS_PATH || path.join(homedir(), '.omlx', 'settings.json')

  try {
    const raw = fs.readFileSync(settingsPath, 'utf8')
    const settings = JSON.parse(raw)

    const host = settings?.server?.host || '127.0.0.1'
    const port = settings?.server?.port || 8000
    const baseUrl = normalizeBaseUrl(envBaseUrl || `http://${host}:${port}`)
    const apiKey = settings?.auth?.api_key || ''

    return {
      baseUrl,
      chatUrl: envApiUrl || `${baseUrl}/v1/chat/completions`,
      apiKey,
      source: settingsPath
    }
  } catch {
    const baseUrl = normalizeBaseUrl(envBaseUrl || DEFAULT_BASE_URL)
    return {
      baseUrl,
      chatUrl: envApiUrl || `${baseUrl}/v1/chat/completions`,
      apiKey: '',
      source: 'defaults'
    }
  }
}

export async function listLocalOmlxModels(): Promise<string[]> {
  const config = readLocalOmlxConfig()

  if (!config.apiKey) {
    return []
  }

  const response = await fetch(`${config.baseUrl}/v1/models`, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`
    }
  })

  if (!response.ok) {
    return []
  }

  const data = await response.json()
  return Array.isArray(data?.data) ? data.data.map((model: { id?: string }) => model.id).filter(Boolean) : []
}

export async function getDefaultLocalOmlxModel(): Promise<string> {
  const envModel = process.env.OMLX_MODEL
  if (envModel) return envModel.includes(':') ? envModel : `omlx:${envModel}`

  const models = await listLocalOmlxModels()
  const preferred = models.find((model) => model.includes('Qwen3.6-27B-UD-MLX-4bit')) || models[0]

  return preferred ? `omlx:${preferred}` : 'omlx:Qwen3.6-27B-UD-MLX-4bit'
}
