import { CONFIG_REFS, loadTestConfig, REQUIRED_CONFIG } from '../config'

describe('regression test configuration', () => {
  const validEnv = {
    CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL: 'https://gateway.example.test/v1',
    CHERRY_TEST_CUSTOM_PROVIDER_API_KEY: 'provider-secret',
    CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL: 'Qwen/Qwen3.6-27B',
    CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_MODEL: 'text-embedding-test',
    CHERRY_TEST_CHERRYIN_CHAT_MODEL: 'cherry-chat-test',
    CHERRY_TEST_CHERRYIN_GEMINI_IMAGE_MODEL: 'gemini-image-test',
    CHERRY_TEST_CHERRYIN_IMAGE2_MODEL: 'image-2-test',
    CHERRY_TEST_CHERRYIN_ACCOUNT: 'automation@example.test',
    CHERRY_TEST_CHERRYIN_PASSWORD: 'account-secret'
  }

  it('uses provider-scoped names without ambiguous legacy variables', () => {
    expect(REQUIRED_CONFIG).toEqual([
      'CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL',
      'CHERRY_TEST_CUSTOM_PROVIDER_API_KEY',
      'CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL',
      'CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_MODEL',
      'CHERRY_TEST_CHERRYIN_CHAT_MODEL',
      'CHERRY_TEST_CHERRYIN_GEMINI_IMAGE_MODEL',
      'CHERRY_TEST_CHERRYIN_IMAGE2_MODEL',
      'CHERRY_TEST_CHERRYIN_ACCOUNT',
      'CHERRY_TEST_CHERRYIN_PASSWORD'
    ])
    expect(REQUIRED_CONFIG.some((name) => /^CHERRY_TEST_(PROVIDER|EMBEDDING|GEMINI|IMAGE2)_/.test(name))).toBe(false)
  })

  it('loads values exposed to the test driver by stable config refs', () => {
    const config = loadTestConfig(validEnv)

    expect(config.customProvider.chatModel).toBe('Qwen/Qwen3.6-27B')
    expect(config.customProvider.embeddingModel).toBe('text-embedding-test')
    expect(config.cherryIn.geminiImageModel).toBe('gemini-image-test')
    expect(CONFIG_REFS.customProviderApiKey(config)).toBe('provider-secret')
    expect(CONFIG_REFS.cherryInPassword(config)).toBe('account-secret')
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
})
