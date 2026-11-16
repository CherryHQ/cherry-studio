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
