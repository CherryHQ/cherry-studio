export const REQUIRED_CONFIG = [
  'CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL',
  'CHERRY_TEST_CUSTOM_PROVIDER_ANTHROPIC_BASE_URL',
  'CHERRY_TEST_CUSTOM_PROVIDER_API_KEY',
  'CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL'
] as const

export type RequiredConfigName = (typeof REQUIRED_CONFIG)[number]

export interface RegressionTestConfig {
  customProvider: {
    baseUrl: string
    anthropicBaseUrl: string
    apiKey: string
    chatModel: string
  }
}

type Environment = Record<string, string | undefined>

export function loadTestConfig(environment: Environment = process.env): RegressionTestConfig {
  const missing = REQUIRED_CONFIG.filter((name) => !environment[name]?.trim())
  if (missing.length > 0) {
    throw new Error(`Missing regression test configuration: ${missing.join(', ')}`)
  }

  const value = (name: RequiredConfigName) => environment[name]!.trim()
  const absoluteUrl = (name: RequiredConfigName) => {
    const result = value(name)
    try {
      new URL(result)
      return result
    } catch {
      throw new Error(`${name} must be an absolute URL`)
    }
  }

  return {
    customProvider: {
      baseUrl: absoluteUrl('CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL'),
      anthropicBaseUrl: absoluteUrl('CHERRY_TEST_CUSTOM_PROVIDER_ANTHROPIC_BASE_URL'),
      apiKey: value('CHERRY_TEST_CUSTOM_PROVIDER_API_KEY'),
      chatModel: value('CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL')
    }
  }
}

export function getSensitiveConfigValues(environment: Environment = process.env): string[] {
  return [environment.CHERRY_TEST_CUSTOM_PROVIDER_API_KEY].flatMap((value) => (value?.trim() ? [value.trim()] : []))
}
