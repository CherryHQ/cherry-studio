import { getSensitiveConfigValues, loadTestConfig, REQUIRED_CONFIG } from '../config'

describe('regression test configuration', () => {
  const validEnv = {
    CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL: 'https://gateway.example.test/v1',
    CHERRY_TEST_CUSTOM_PROVIDER_API_KEY: 'provider-secret',
    CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL: 'Qwen/Qwen3.6-27B',
    CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_BASE_URL: 'https://embedding.example.test/v1',
    CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_API_KEY: 'embedding-secret',
    CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_MODEL: 'text-embedding-test',
    CHERRY_TEST_CHERRYIN_CHAT_MODEL: 'cherry-chat-test',
    CHERRY_TEST_CHERRYIN_IMAGE_MODEL: 'image-test',
    CHERRY_TEST_CHERRYIN_ACCOUNT: 'automation@example.test',
    CHERRY_TEST_CHERRYIN_PASSWORD: 'account-secret'
  }

  it('uses provider-scoped names without ambiguous legacy variables', () => {
    expect(REQUIRED_CONFIG).toEqual([
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
    ])
    expect(REQUIRED_CONFIG.some((name) => /^CHERRY_TEST_(PROVIDER|EMBEDDING|GEMINI|IMAGE2)_/.test(name))).toBe(false)
  })

  it('loads provider-scoped values for Playwright', () => {
    const config = loadTestConfig(validEnv)

    expect(config.customProvider.chatModel).toBe('Qwen/Qwen3.6-27B')
    expect(config.customEmbeddingProvider).toEqual({
      apiKey: 'embedding-secret',
      baseUrl: 'https://embedding.example.test/v1',
      model: 'text-embedding-test'
    })
    expect(config.cherryIn.imageModel).toBe('image-test')
    expect(config.customProvider.apiKey).toBe('provider-secret')
    expect(config.customEmbeddingProvider.apiKey).toBe('embedding-secret')
    expect(config.cherryIn.password).toBe('account-secret')
    expect(getSensitiveConfigValues(config)).toEqual([
      'provider-secret',
      'embedding-secret',
      'automation@example.test',
      'account-secret'
    ])
  })

  it('fails before application launch when any required value is blank', () => {
    expect(() =>
      loadTestConfig({
        ...validEnv,
        CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL: '   ',
        CHERRY_TEST_CHERRYIN_ACCOUNT: undefined
      })
    ).toThrow(
      'Missing regression test configuration: CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL, CHERRY_TEST_CHERRYIN_ACCOUNT'
    )
  })

  it('validates both provider base URLs before application launch', () => {
    expect(() =>
      loadTestConfig({
        ...validEnv,
        CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_BASE_URL: 'not-a-url'
      })
    ).toThrow('CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_BASE_URL must be an absolute URL')
  })
})
