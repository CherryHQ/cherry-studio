import { randomUUID } from 'node:crypto'

import { LRUCache } from 'lru-cache'

import { application } from '@application'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { parseProfileStarters } from '@shared/ai/profileStarters'
import type { ProfileStarter } from '@shared/data/cache/cacheValueTypes'
import { parseUniqueModelId, UniqueModelIdSchema } from '@shared/data/types/model'
import type { InputFor } from '@shared/ipc/types'

const logger = loggerService.withContext('profileStarters')
const pending = new Map<string, Promise<ProfileStarter[] | null>>()
const results = new LRUCache<string, ProfileStarter[]>({ max: 50 })

export async function generateProfileStarters(
  input: InputFor<'ai.profile_starters.generate'>
): Promise<ProfileStarter[] | null> {
  const preferred = UniqueModelIdSchema.safeParse(application.get('PreferenceService').get('chat.default_model_id'))
  if (!preferred.success) return null

  const { modelId, providerId } = parseUniqueModelId(preferred.data)
  const provider = providerService.getByProviderId(providerId)
  if (!provider.isEnabled) return null
  const model = modelService.getByKey(providerId, modelId)
  if (!model.isEnabled) return null

  const key = JSON.stringify([preferred.data, input.ownerId, input.mode, input.identityHash])
  const cached = results.get(key)
  if (cached !== undefined) return cached
  const current = pending.get(key)
  if (current) return current

  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<ProfileStarter[] | null>((resolve) => {
    timer = setTimeout(() => {
      resolve(null)
      controller.abort()
    }, 30_000)
    timer.unref()
  })
  const response = application
    .get('AiService')
    .generateText({
      uniqueModelId: model.id,
      resolvedModel: { provider, model },
      conversation: { id: `profile-starters:${randomUUID()}` },
      system: input.system,
      prompt: input.prompt,
      reasoningEffort: 'none',
      disableTools: true,
      requestOptions: { signal: controller.signal, maxRetries: 0 }
    })
    .then(({ text }) => {
      const items = parseProfileStarters(text, input.mode)
      if (text && !items) logger.warn('Generated profile starters did not validate', { ownerId: input.ownerId })
      return items
    })
  const generation = Promise.race([response, timeout])
    .then((items) => {
      if (items) results.set(key, items)
      return items
    })
    .finally(() => {
      clearTimeout(timer)
      pending.delete(key)
    })

  pending.set(key, generation)
  return generation
}
