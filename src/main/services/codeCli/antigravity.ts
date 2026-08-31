import { readFile } from 'node:fs/promises'

import { application } from '@application'
import { providerService } from '@data/services/ProviderService'
import { atomicWriteFile } from '@main/utils/file'
import type { CodeCliRunInput } from '@shared/ipc/schemas/codeCli'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { ANTIGRAVITY_MODEL_PATH_SEPARATOR, formatGatewayModelId, gatewayClientOrigin } from '@shared/utils/apiGateway'
import { resolveGeminiBaseUrl } from '@shared/utils/gemini'

import { type SecretEnvFile, writeSecretEnvFile } from './secretEnvFile'
import { isShellSafeModelId } from './shellQuote'

type NormalRunInput = Extract<CodeCliRunInput, { mode: 'normal' }>

interface AntigravityLaunchConfig {
  secretEnv: SecretEnvFile
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
    // Only this path form is ambiguous about the separator: the route splits on the first
    // one, so a provider id carrying it would address the wrong provider.
    if (input.providerId.includes(ANTIGRAVITY_MODEL_PATH_SEPARATOR)) {
      throw new Error(
        `Provider id "${input.providerId}" contains "${ANTIGRAVITY_MODEL_PATH_SEPARATOR}" and cannot be addressed by antigravity-cli`
      )
    }
    const gatewayModel = formatGatewayModelId(input.providerId, input.model)
    model = `gemini-api://${gatewayModel.replace(':', ANTIGRAVITY_MODEL_PATH_SEPARATOR)}`
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
    geminiDir: await ensureGeminiModeSettings(),
    secretEnv: await writeSecretEnvFile(
      AbsoluteFilePathSchema.parse(application.getPath('feature.cli.antigravity.env.file')),
      { GEMINI_API_KEY: apiKey, ...(baseUrl ? { GOOGLE_GEMINI_BASE_URL: baseUrl } : {}) }
    ),
    model
  }
}
