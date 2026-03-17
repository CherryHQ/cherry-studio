import { defineCatalog } from '@json-render/core'
import { schema } from '@json-render/react/schema'
import { shadcnComponentDefinitions } from '@json-render/shadcn/catalog'

/**
 * Catalog defining all components and actions available for AI-generated UI.
 * Uses the full shadcn component set (36 components).
 */
export const catalog = defineCatalog(schema, {
  components: {
    ...shadcnComponentDefinitions
  },
  actions: {}
})
