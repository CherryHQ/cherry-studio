export const REQUIRED_CONFIG = [
  'CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL',
  'CHERRY_TEST_CUSTOM_PROVIDER_API_KEY',
  'CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL',
  'CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_BASE_URL',
  'CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_API_KEY',
  'CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_MODEL',
  'CHERRY_TEST_CHERRYIN_CHAT_MODEL',
  'CHERRY_TEST_CHERRYIN_IMAGE_MODEL',
  'CHERRY_TEST_CHERRYIN_ACCOUNT',
  'CHERRY_TEST_CHERRYIN_PASSWORD'
] as const

export type RequiredConfigName = (typeof REQUIRED_CONFIG)[number]

export interface RegressionTestConfig {
  customProvider: {
    baseUrl: string
    apiKey: string
    chatModel: string
  }
  customEmbeddingProvider: {
    baseUrl: string
    apiKey: string
    model: string
  }
  cherryIn: {
    chatModel: string
    imageModel: string
    account: string
    password: string
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
      apiKey: value('CHERRY_TEST_CUSTOM_PROVIDER_API_KEY'),
      chatModel: value('CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL')
    },
    customEmbeddingProvider: {
      baseUrl: absoluteUrl('CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_BASE_URL'),
      apiKey: value('CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_API_KEY'),
      model: value('CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_MODEL')
    },
    cherryIn: {
      chatModel: value('CHERRY_TEST_CHERRYIN_CHAT_MODEL'),
      imageModel: value('CHERRY_TEST_CHERRYIN_IMAGE_MODEL'),
      account: value('CHERRY_TEST_CHERRYIN_ACCOUNT'),
      password: value('CHERRY_TEST_CHERRYIN_PASSWORD')
    }
  }
}

export function getSensitiveConfigValues(config: RegressionTestConfig): string[] {
  return [
    config.customProvider.apiKey,
    config.customEmbeddingProvider.apiKey,
    config.cherryIn.account,
    config.cherryIn.password
  ]
}
