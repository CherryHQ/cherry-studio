import { readFile } from 'node:fs/promises'

import { application } from '@application'
import {
  antigravityGatewayModel,
  antigravityGeminiSettings,
  antigravityGeminiEnvironment
} from '@cherrystudio/agent-runtime-antigravity-acp/terminal'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { atomicWriteFile } from '@main/utils/file'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import type { CodeCliRunInput } from '@shared/ipc/schemas/codeCli'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { formatGatewayModelId, gatewayClientOrigin } from '@shared/utils/apiGateway'
import { resolveGeminiBaseUrl } from '@shared/utils/gemini'
import { getRawModelId } from '@shared/utils/model'

import { isShellSafeModelId } from './shellQuote'

function resolveUserModelForLaunch(providerId: string, launchModelId: string): Model {
  const match = modelService.list({ providerId }).find((entry) => {
    const storedId = parseUniqueModelId(entry.id).modelId
    return storedId === launchModelId || entry.apiModelId === launchModelId || getRawModelId(entry) === launchModelId
  })
  if (match) return match
  return modelService.getByKey(providerId, launchModelId)
}

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

  await atomicWriteFile(settingsPath, antigravityGeminiSettings(settings), {
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
    model = antigravityGatewayModel(formatGatewayModelId(input.providerId, input.model))
  } else {
    const provider = providerService.getByProviderId(input.providerId)
    const userModel = resolveUserModelForLaunch(input.providerId, input.model)
    apiKey = providerService.resolveApiKey(provider.id, undefined, userModel.apiKeyId).value
    baseUrl = resolveGeminiBaseUrl(provider)
    model = userModel.apiModelId ?? input.model
  }

  if (!apiKey) throw new Error('Antigravity CLI requires an API key')
  // Reject before `ensureGeminiModeSettings` so a launch that cannot proceed leaves
  // the isolated settings file untouched.
  if (!isShellSafeModelId(model)) throw new Error(`Unsupported model id for antigravity-cli: ${model}`)

  return {
    env: antigravityGeminiEnvironment(apiKey, baseUrl),
    geminiDir: await ensureGeminiModeSettings(),
    model
  }
}
