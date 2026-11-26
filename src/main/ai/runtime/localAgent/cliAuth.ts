import { localCliPresetById } from '@shared/ai/localAgent'

export interface CliAuthCommandSpec {
  args: string[]
  stdin?: string
  autoOpenUrl?: boolean
}

export interface CliAuthOptions {
  secret?: string
  provider?: string
}

const VALID_PROVIDER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export function resolveCliAuthCommand(
  presetId: string | undefined,
  methodId: string,
  options?: CliAuthOptions
): CliAuthCommandSpec | undefined {
  const preset = presetId ? localCliPresetById.get(presetId) : undefined
  const method = preset?.cliLogin?.find((option) => option.id === methodId)
  if (method) {
    const args = [...method.args]
    if (method.kind === 'api-key') {
      const secret = options?.secret?.trim()
      if (!secret) throw new Error('API key is required')
      return { args, stdin: `${secret}\n` }
    }
    return { args, ...(method.autoOpenUrl && { autoOpenUrl: true }) }
  }
  if (preset?.providerLogin?.id === methodId) {
    const provider = options?.provider?.trim()
    if (!provider || !VALID_PROVIDER_PATTERN.test(provider)) throw new Error('Valid provider ID is required')
    return { args: [...preset.providerLogin.args, provider], autoOpenUrl: true }
  }
}
