import { getSensitiveConfigValues, loadTestConfig } from '../config'

describe('regression test configuration', () => {
  const validEnv = {
    CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL: 'https://gateway.example.test/v1',
    CHERRY_TEST_CUSTOM_PROVIDER_ANTHROPIC_BASE_URL: ' https://anthropic.example.test ',
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

  it('requires a separate Anthropic URL instead of reusing the OpenAI URL', () => {
    expect(() => loadTestConfig({ ...validEnv, CHERRY_TEST_CUSTOM_PROVIDER_ANTHROPIC_BASE_URL: undefined })).toThrow(
      'Missing regression test configuration: CHERRY_TEST_CUSTOM_PROVIDER_ANTHROPIC_BASE_URL'
    )
  })

  it('loads provider-scoped values for Playwright', () => {
    const config = loadTestConfig(validEnv)

    expect(config.customProvider).toEqual({
      baseUrl: 'https://gateway.example.test/v1',
      anthropicBaseUrl: 'https://anthropic.example.test',
      apiKey: 'provider-secret',
      chatModel: 'Qwen/Qwen3.6-27B'
    })
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

  it.each([
    'CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL',
    'CHERRY_TEST_CUSTOM_PROVIDER_ANTHROPIC_BASE_URL',
    'CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_BASE_URL'
  ])('validates %s before application launch', (name) => {
    expect(() =>
      loadTestConfig({
        ...validEnv,
        [name]: 'not-a-url'
      })
    ).toThrow(`${name} must be an absolute URL`)
  })
})
