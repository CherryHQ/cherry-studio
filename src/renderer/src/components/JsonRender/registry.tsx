import { defineRegistry } from '@json-render/react'
import { shadcnComponents } from '@json-render/shadcn'

import { catalog } from './catalog'
import { cherryComponents } from './cherryComponents'

/**
 * Registry: Cherry UI components override @json-render/shadcn defaults.
 * Missing components fall through to shadcn built-ins.
 */
export const { registry, handlers } = defineRegistry(catalog, {
  components: {
    ...shadcnComponents,
    ...cherryComponents
  }
})
