import { readProfileConfig } from '../profile'

const chat = {
  CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL: 'https://chat.example/v1',
  CHERRY_TEST_CUSTOM_PROVIDER_API_KEY: 'chat-secret',
  CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL: 'chat-model'
}

it.each(Object.keys(chat))('rejects authenticated runs missing %s', (key) => {
  expect(() => readProfileConfig({ ...chat, [key]: '' })).toThrow()
})

it('accepts chat credentials without requiring unrelated regression accounts', () => {
  expect(readProfileConfig(chat)).toEqual({
    baseUrl: 'https://chat.example/v1',
    apiKey: 'chat-secret',
    model: 'chat-model'
  })
  expect(() => readProfileConfig({ ...chat, CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL: 'invalid' })).toThrow()
})

it('requires a complete embedding configuration when any embedding field is supplied', () => {
  expect(() => readProfileConfig({ ...chat, CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_MODEL: 'embedding-model' })).toThrow()
  expect(
    readProfileConfig({
      ...chat,
      CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_BASE_URL: 'https://embedding.example/v1',
      CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_API_KEY: 'embedding-secret',
      CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_MODEL: 'embedding-model'
    }).embedding
  ).toEqual({ baseUrl: 'https://embedding.example/v1', apiKey: 'embedding-secret', model: 'embedding-model' })
})
