import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { BaseService } from '../BaseService'

class TestBaseService extends BaseService {
  public resolve(value: string | null | undefined) {
    return this.resolveUserModelId(value)
  }
}

describe('BaseService.resolveUserModelId', () => {
  const dbh = setupTestDatabase()
  const service = new TestBaseService()

  it('returns null for empty input', async () => {
    expect(await service.resolve(undefined)).toBeNull()
    expect(await service.resolve(null)).toBeNull()
    expect(await service.resolve('')).toBeNull()
  })

  it('returns the user_model id when the input is already the canonical form', async () => {
    await dbh.db.insert(userProviderTable).values({ providerId: 'openai', name: 'OpenAI' })
    await dbh.db.insert(userModelTable).values({
      id: 'openai::gpt-4',
      providerId: 'openai',
      modelId: 'gpt-4'
    })

    expect(await service.resolve('openai::gpt-4')).toBe('openai::gpt-4')
  })

  it('maps a legacy "providerId:modelId" value to the matching user_model id', async () => {
    await dbh.db.insert(userProviderTable).values({ providerId: 'anthropic', name: 'Anthropic' })
    await dbh.db.insert(userModelTable).values({
      id: 'anthropic::claude-3-5-sonnet',
      providerId: 'anthropic',
      modelId: 'claude-3-5-sonnet'
    })

    expect(await service.resolve('anthropic:claude-3-5-sonnet')).toBe('anthropic::claude-3-5-sonnet')
  })

  it('returns null when the value does not match any user_model row', async () => {
    await dbh.db.insert(userProviderTable).values({ providerId: 'openai', name: 'OpenAI' })
    await dbh.db.insert(userModelTable).values({
      id: 'openai::gpt-4',
      providerId: 'openai',
      modelId: 'gpt-4'
    })

    expect(await service.resolve('unknown:ghost')).toBeNull()
    expect(await service.resolve('unknown::ghost')).toBeNull()
  })
})
