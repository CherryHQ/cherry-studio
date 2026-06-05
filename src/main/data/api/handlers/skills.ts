/**
 * Skills API Handlers.
 */

import { agentGlobalSkillService as skillService } from '@data/services/AgentGlobalSkillService'
import { DataApiErrorFactory, toDataApiError } from '@shared/data/api'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import { ListSkillsQuerySchema, type SkillSchemas } from '@shared/data/api/schemas/skills'

export const skillHandlers: HandlersFor<SkillSchemas> = {
  '/skills': {
    GET: async ({ query }) => {
      const parsed = ListSkillsQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      return await skillService.list(parsed.data)
    }
  },

  '/skills/:skillId': {
    GET: async ({ params }) => {
      const skill = await skillService.getById(params.skillId)
      if (!skill) throw DataApiErrorFactory.notFound('Skill', params.skillId)
      return skill
    }
  }
}
