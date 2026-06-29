import { createUniqueModelId } from '@shared/data/types/model'

/**
 * Tencent Hunyuan preset model.
 *
 * The Hunyuan provider ships a single preset model — `hy3` — served through
 * `tokenhub.tencentmaas.com`. It is exposed over both the OpenAI
 * chat-completions protocol (normal chat) and the Anthropic messages protocol
 * (agent chat); see `providers.json` / `provider-models.json` for the wire
 * config. The seeder inserts this row so the model appears in the provider's
 * list on a fresh install without requiring an upstream model pull.
 */
export const HUNYUAN_PROVIDER_ID = 'hunyuan' as const
export const HUNYUAN_HY3_MODEL_ID = 'hy3' as const
export const HUNYUAN_HY3_MODEL_NAME = 'Hy3' as const
export const HUNYUAN_HY3_MODEL_GROUP = 'Hy' as const
export const HUNYUAN_HY3_UNIQUE_MODEL_ID = createUniqueModelId(HUNYUAN_PROVIDER_ID, HUNYUAN_HY3_MODEL_ID)
