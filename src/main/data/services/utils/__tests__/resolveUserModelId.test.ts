import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { resolveAgentModelFieldsInPlace, resolveUserModelId } from '@data/services/utils/resolveUserModelId'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

describe('resolveUserModelId', () => {
  const dbh = setupTestDatabase()

  async function seedUserModel(providerId: string, modelId: string) {
    await dbh.db.insert(userProviderTable).values({ providerId, name: providerId }).onConflictDoNothing()
    const id = `${providerId}::${modelId}`
    await dbh.db.insert(userModelTable).values({ id, providerId, modelId })
    return id
  }

  it('returns null for null/undefined/empty input', async () => {
    expect(await resolveUserModelId(dbh.db, null)).toBeNull()
    expect(await resolveUserModelId(dbh.db, undefined)).toBeNull()
    expect(await resolveUserModelId(dbh.db, '')).toBeNull()
  })

  it('passes through canonical user_model.id (UniqueModelId form)', async () => {
    const id = await seedUserModel('openai', 'gpt-4')
    expect(await resolveUserModelId(dbh.db, id)).toBe(id)
  })

  it('maps legacy providerId:modelId to user_model.id', async () => {
    const id = await seedUserModel('anthropic', 'claude-3-5-sonnet')
    expect(await resolveUserModelId(dbh.db, 'anthropic:claude-3-5-sonnet')).toBe(id)
  })

  it('returns null for values that do not match any user_model row', async () => {
    expect(await resolveUserModelId(dbh.db, 'ghost:model')).toBeNull()
    expect(await resolveUserModelId(dbh.db, 'nonexistent::id')).toBeNull()
  })

  describe('resolveAgentModelFieldsInPlace', () => {
    it('rewrites every present model field through resolveUserModelId', async () => {
      const main = await seedUserModel('openai', 'gpt-4')
      const plan = await seedUserModel('anthropic', 'claude-opus-4')
      const small = await seedUserModel('openai', 'gpt-4o-mini')

      const target = {
        model: 'openai:gpt-4',
        planModel: plan,
        smallModel: 'openai:gpt-4o-mini',
        // unrelated fields must be left alone
        name: 'untouched',
        sortOrder: 0
      }

      const result = await resolveAgentModelFieldsInPlace(dbh.db, target)

      expect(result).toBe(target) // same reference (in place)
      expect(target).toEqual({
        model: main,
        planModel: plan,
        smallModel: small,
        name: 'untouched',
        sortOrder: 0
      })
    })

    it('only touches fields that are present (partial-update safe)', async () => {
      const main = await seedUserModel('openai', 'gpt-4')

      const target: Record<string, unknown> = {
        model: 'openai:gpt-4'
        // planModel / smallModel intentionally absent
      }

      await resolveAgentModelFieldsInPlace(dbh.db, target)

      expect(target).toEqual({ model: main })
      expect(Object.prototype.hasOwnProperty.call(target, 'planModel')).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(target, 'smallModel')).toBe(false)
    })

    it('rewrites unresolvable values to null', async () => {
      const target = { model: 'unknown:foo' }
      await resolveAgentModelFieldsInPlace(dbh.db, target)
      expect(target).toEqual({ model: null })
    })
  })
})
