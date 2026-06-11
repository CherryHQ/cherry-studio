import { createUniqueModelId } from '@shared/data/types/model'

export const CHERRYAI_PROVIDER_ID = 'cherryai' as const
export const CHERRYAI_PROVIDER_NAME = 'CherryAI' as const
export const CHERRYAI_DEFAULT_MODEL_ID = 'Qwen/Qwen3-8B' as const
export const CHERRYAI_DEFAULT_MODEL_NAME = 'Qwen/Qwen3-8B' as const
export const CHERRYAI_DEFAULT_MODEL_GROUP = 'Qwen' as const
export const CHERRYAI_API_BASE_URL = 'https://api.cherry-ai.com' as const
export const CHERRYAI_DEFAULT_UNIQUE_MODEL_ID = createUniqueModelId(CHERRYAI_PROVIDER_ID, CHERRYAI_DEFAULT_MODEL_ID)
