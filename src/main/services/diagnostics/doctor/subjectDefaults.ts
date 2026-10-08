import { application } from '@application'
import { parseUniqueModelId, UniqueModelIdSchema } from '@shared/data/types/model'

import type { DoctorContextBase } from './types'

export function defaultChatModelId(ctx: DoctorContextBase): Promise<string | null> {
  return ctx.share('provider:default-model-id', async () =>
    application.get('PreferenceService').get('chat.default_model_id')
  )
}

export async function defaultChatModel(
  ctx: DoctorContextBase
): Promise<{ providerId: string; modelId: string } | null> {
  const parsed = UniqueModelIdSchema.safeParse(await defaultChatModelId(ctx))
  return parsed.success ? parseUniqueModelId(parsed.data) : null
}
