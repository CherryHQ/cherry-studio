import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { createUniqueModelId, ENDPOINT_TYPE } from '@shared/data/types/model'

import { generateProfileStarters } from '../profileStarters'

const defaultId = createUniqueModelId('starter-wire', 'test')
const request = {
  ownerId: 'assistant-1',
  mode: 'assistant',
  identityHash: 'first',
  system: 'Suggest questions',
  prompt: 'Private prompt'
} as const

function questions(label: string) {
  return Array.from({ length: 4 }, (_, i) => ({
    kind: 'generic',
    title: `${label} ${i + 1}`,
    hint: '',
    prompt: `${label} ${i + 1}:`
  }))
}

const reply = (label: string) => ({ text: JSON.stringify({ items: questions(label) }) })

describe('profile starter generation', () => {
  const dbh = setupTestDatabase()
  const generateText = vi.fn()

  beforeEach(() => {
    generateText.mockReset()
    MockApplicationUtils.setService('AiService', { generateText })
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.default_model_id', defaultId)
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'starter-wire',
        name: 'Profile starter provider',
        isEnabled: true,
        orderKey: 'a0',
        endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://openai.test/v1' } },
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
      })
      .run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: defaultId,
        providerId: 'starter-wire',
        modelId: 'test',
        name: 'Test',
        capabilities: [],
        supportsStreaming: true,
        isEnabled: true,
        orderKey: 'a0',
        endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
      })
      .run()
  })

  afterEach(() => {
    MockMainPreferenceServiceUtils.resetMocks()
    MockApplicationUtils.resetServices()
  })

  it('shares a running model call across windows for the same profile identity', async () => {
    const inFlight = Promise.withResolvers<{ text: string }>()
    generateText.mockReturnValueOnce(inFlight.promise).mockResolvedValue(reply('New questions'))
    const first = generateProfileStarters(request)
    const second = generateProfileStarters(request)

    inFlight.resolve(reply('Shared questions'))
    await expect(Promise.all([first, second])).resolves.toEqual([
      questions('Shared questions'),
      questions('Shared questions')
    ])
    await expect(generateProfileStarters({ ...request, identityHash: 'updated' })).resolves.toEqual(
      questions('New questions')
    )
  })

  it('releases a timed-out request even when generation has not settled', async () => {
    vi.useFakeTimers()
    try {
      generateText.mockReturnValueOnce(Promise.withResolvers<{ text: string }>().promise)
      generateText.mockResolvedValueOnce(reply('Questions after retry'))
      const requestAfterFailure = { ...request, identityHash: 'deadline' }
      const started = generateProfileStarters(requestAfterFailure)
      await vi.advanceTimersByTimeAsync(30_000)
      await expect(started).resolves.toBeNull()
      await expect(generateProfileStarters(requestAfterFailure)).resolves.toEqual(questions('Questions after retry'))
    } finally {
      vi.useRealTimers()
    }
  })

  it('reuses a completed response even if no window published it before reopening', async () => {
    vi.useFakeTimers()
    try {
      const previous = { ...request, identityHash: 'closed-window' }
      generateText.mockResolvedValueOnce(reply('From the closed window'))
      await expect(generateProfileStarters(previous)).resolves.toEqual(questions('From the closed window'))

      await vi.advanceTimersByTimeAsync(60_000)
      generateText.mockResolvedValueOnce(reply('A duplicate request'))
      await expect(generateProfileStarters(previous)).resolves.toEqual(questions('From the closed window'))
    } finally {
      vi.useRealTimers()
    }
  })

  it('lets another window retry invalid model output', async () => {
    const invalid = { ...request, identityHash: 'invalid-response' }
    generateText.mockResolvedValueOnce({ text: 'Invalid response' }).mockResolvedValueOnce(reply('Valid retry'))

    await expect(generateProfileStarters(invalid)).resolves.toBeNull()
    await expect(generateProfileStarters(invalid)).resolves.toEqual(questions('Valid retry'))
  })

  it('does not send profile text to a disabled default provider', async () => {
    generateText.mockResolvedValue({ text: 'Leaked profile text' })
    dbh.db
      .update(userProviderTable)
      .set({ isEnabled: false })
      .where(eq(userProviderTable.providerId, 'starter-wire'))
      .run()

    await expect(generateProfileStarters(request)).resolves.toBeNull()
    expect(generateText).not.toHaveBeenCalled()
  })
})
