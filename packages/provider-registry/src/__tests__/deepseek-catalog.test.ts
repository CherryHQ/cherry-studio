import { describe, expect, it } from 'vitest'

import { bundledCatalog } from '../bundled-catalog'
import { createRegistry } from '../registry'

const registry = createRegistry(bundledCatalog)

describe('DeepSeek V4.1 Flash output capacity', () => {
  it.each(['deepseek-flash', 'deepseek-v4-1-flash', 'deepseek-v4.1-flash'])(
    'resolves the documented output limit for %s instead of leaving runtimes to use a fallback',
    (id) => {
      expect(registry.findModel(id)?.maxOutputTokens).toBe(393216)
    }
  )
})
