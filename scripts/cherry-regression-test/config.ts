export const REQUIRED_CONFIG = [
  'CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL',
  'CHERRY_TEST_CUSTOM_PROVIDER_API_KEY',
  'CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL',
  'CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_MODEL',
  'CHERRY_TEST_CHERRYIN_CHAT_MODEL',
  'CHERRY_TEST_CHERRYIN_GEMINI_IMAGE_MODEL',
  'CHERRY_TEST_CHERRYIN_IMAGE2_MODEL',
  'CHERRY_TEST_CHERRYIN_ACCOUNT',
  'CHERRY_TEST_CHERRYIN_PASSWORD'
] as const

export type RequiredConfigName = (typeof REQUIRED_CONFIG)[number]
export type ConfigRef = keyof typeof CONFIG_REFS

export interface RegressionTestConfig {
  customProvider: {
    baseUrl: string
    apiKey: string
    chatModel: string
    embeddingModel: string
  }
  cherryIn: {
    chatModel: string
    geminiImageModel: string
    image2Model: string
    account: string
    password: string
  }
}

type Environment = Record<string, string | undefined>

export const CONFIG_REFS = {
  customProviderBaseUrl: (config: RegressionTestConfig) => config.customProvider.baseUrl,
  customProviderApiKey: (config: RegressionTestConfig) => config.customProvider.apiKey,
  customProviderChatModel: (config: RegressionTestConfig) => config.customProvider.chatModel,
  customProviderEmbeddingModel: (config: RegressionTestConfig) => config.customProvider.embeddingModel,
  cherryInChatModel: (config: RegressionTestConfig) => config.cherryIn.chatModel,
  cherryInGeminiImageModel: (config: RegressionTestConfig) => config.cherryIn.geminiImageModel,
  cherryInImage2Model: (config: RegressionTestConfig) => config.cherryIn.image2Model,
  cherryInAccount: (config: RegressionTestConfig) => config.cherryIn.account,
  cherryInPassword: (config: RegressionTestConfig) => config.cherryIn.password
} as const

export function loadTestConfig(environment: Environment = process.env): RegressionTestConfig {
  const missing = REQUIRED_CONFIG.filter((name) => !environment[name]?.trim())
  if (missing.length > 0) {
    throw new Error(`Missing regression test configuration: ${missing.join(', ')}`)
  }

  const value = (name: RequiredConfigName) => environment[name]!.trim()
  const baseUrl = value('CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL')
  try {
    new URL(baseUrl)
  } catch {
    throw new Error('CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL must be an absolute URL')
  }

  return {
    customProvider: {
      baseUrl,
      apiKey: value('CHERRY_TEST_CUSTOM_PROVIDER_API_KEY'),
      chatModel: value('CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL'),
      embeddingModel: value('CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_MODEL')
    },
    cherryIn: {
      chatModel: value('CHERRY_TEST_CHERRYIN_CHAT_MODEL'),
      geminiImageModel: value('CHERRY_TEST_CHERRYIN_GEMINI_IMAGE_MODEL'),
      image2Model: value('CHERRY_TEST_CHERRYIN_IMAGE2_MODEL'),
      account: value('CHERRY_TEST_CHERRYIN_ACCOUNT'),
      password: value('CHERRY_TEST_CHERRYIN_PASSWORD')
    }
  }
}

export function getConfigRef(config: RegressionTestConfig, ref: ConfigRef): string {
  return CONFIG_REFS[ref](config)
}

export function getSensitiveConfigValues(config: RegressionTestConfig): string[] {
  return [config.customProvider.apiKey, config.cherryIn.account, config.cherryIn.password]
}
