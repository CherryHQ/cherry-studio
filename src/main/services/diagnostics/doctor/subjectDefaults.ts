import { application } from '@application'
import { parseUniqueModelId, UniqueModelIdSchema } from '@shared/data/types/model'

/**
 * What a global run judges when no subject names a model: the chat default. `null` when it is
 * unset or malformed — `provider-model` reports those two cases itself, so dependants only throw.
 */
export function defaultChatModel(): { readonly providerId: string; readonly modelId: string } | null {
  const parsed = UniqueModelIdSchema.safeParse(application.get('PreferenceService').get('chat.default_model_id'))
  return parsed.success ? parseUniqueModelId(parsed.data) : null
}
