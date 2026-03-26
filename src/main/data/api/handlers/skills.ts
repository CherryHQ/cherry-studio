/**
 * Skill API Handlers
 *
 * Implements all skill-related API endpoints including:
 * - Skill CRUD (register, get, update, unregister)
 * - Enable/disable toggle
 * - Version history listing
 */

import { skillService } from '@data/services/SkillService'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { SkillSchemas } from '@shared/data/api/schemas/skills'

type SkillHandler<Path extends keyof SkillSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>

export const skillHandlers: {
  [Path in keyof SkillSchemas]: {
    [Method in keyof SkillSchemas[Path]]: SkillHandler<Path, Method & ApiMethods<Path>>
  }
} = {
  '/skills': {
    GET: async () => {
      return await skillService.list()
    },
    POST: async ({ body }) => {
      return await skillService.create(body)
    }
  },

  '/skills/:id': {
    GET: async ({ params }) => {
      return await skillService.getById(params.id)
    },
    PATCH: async ({ params, body }) => {
      return await skillService.update(params.id, body)
    },
    DELETE: async ({ params }) => {
      await skillService.delete(params.id)
      return undefined
    }
  },

  '/skills/:id/enable': {
    PUT: async ({ params }) => {
      return await skillService.enable(params.id)
    }
  },

  '/skills/:id/disable': {
    PUT: async ({ params }) => {
      return await skillService.disable(params.id)
    }
  },

  '/skills/:id/versions': {
    GET: async ({ params }) => {
      return await skillService.listVersions(params.id)
    }
  }
}
