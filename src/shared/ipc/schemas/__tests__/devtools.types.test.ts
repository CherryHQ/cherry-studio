import { describe, expectTypeOf, it } from 'vitest'
import type * as z from 'zod'

import type { devtoolsRequestSchemas } from '../devtools'

type Schemas = typeof devtoolsRequestSchemas

describe('devtools schema type contracts', () => {
  it('toggle is fire-and-forget', () => {
    expectTypeOf<z.infer<Schemas['devtools.toggle']['input']>>().toEqualTypeOf<void>()
    expectTypeOf<z.infer<Schemas['devtools.toggle']['output']>>().toEqualTypeOf<void>()
  })
})
