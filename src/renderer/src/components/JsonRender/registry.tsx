import { defineRegistry } from '@json-render/react'
import { shadcnComponents } from '@json-render/shadcn'

import { catalog } from './catalog'

/**
 * Registry mapping catalog component types to shadcn React implementations.
 */
export const { registry, handlers } = defineRegistry(catalog, {
  components: {
    ...shadcnComponents
  }
})
