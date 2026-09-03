import { readFile } from 'node:fs/promises'

import { application } from '@application'
import { providerService } from '@data/services/ProviderService'
import { atomicWriteFile } from '@main/utils/file'
import type { CodeCliRunInput } from '@shared/ipc/schemas/codeCli'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { formatAntigravityGatewayModelPath, gatewayClientOrigin } from '@shared/utils/apiGateway'
import { resolveGeminiBaseUrl } from '@shared/utils/gemini'

import { isShellSafeModelId } from './shellQuote'

type NormalRunInput = Extract<CodeCliRunInput, { mode: 'normal' }>

interface AntigravityLaunchConfig {
  env: Record<string, string>
  geminiDir: string
  model: string
}

async function ensureGeminiModeSettings(): Promise<string> {
  const geminiDir = application.getPath('feature.cli.antigravity.root')
  const settingsPath = AbsoluteFilePathSchema.parse(application.getPath('feature.cli.antigravity.settings.file'))

  let settings: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(await readFile(settingsPath, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('settings must be a JSON object')
    }
    settings = parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error('Failed to read Antigravity CLI settings', { cause: error })
    }
  }

  await atomicWriteFile(settingsPath, `${JSON.stringify({ ...settings, modelProvider: 'gemini' }, null, 2)}\n`, {
    mode: 0o600
  })
  return geminiDir
}

export async function prepareAntigravityLaunch(input: NormalRunInput): Promise<AntigravityLaunchConfig> {
  let apiKey: string | null
  let baseUrl: string
  let model = input.model

  if (input.gateway) {
    const {
      host,
      port,
      apiKey: gatewayApiKey
    } = application.get('PreferenceService').getMultiple({
      host: 'feature.api_gateway.host',
      port: 'feature.api_gateway.port',
      apiKey: 'feature.api_gateway.api_key'
    })
    apiKey = gatewayApiKey
    baseUrl = gatewayClientOrigin(host, port)
    model = `gemini-api://${formatAntigravityGatewayModelPath(input.providerId, input.model)}`
  } else {
    const provider = providerService.getByProviderId(input.providerId)
    apiKey = providerService.getRotatedApiKey(provider.id)
    baseUrl = resolveGeminiBaseUrl(provider)
  }

  if (!apiKey) throw new Error('Antigravity CLI requires an API key')
  // Reject before `ensureGeminiModeSettings` so a launch that cannot proceed leaves
  // the isolated settings file untouched.
  if (!isShellSafeModelId(model)) throw new Error(`Unsupported model id for antigravity-cli: ${model}`)

  return {
    env: {
      GEMINI_API_KEY: apiKey,
      ...(baseUrl ? { GOOGLE_GEMINI_BASE_URL: baseUrl } : {})
    },
    geminiDir: await ensureGeminiModeSettings(),
    model
  }
}
