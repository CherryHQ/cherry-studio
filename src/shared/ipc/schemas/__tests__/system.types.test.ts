import { describe, expectTypeOf, it } from 'vitest'
import type * as z from 'zod'

import type { systemRequestSchemas } from '../system'

type Schemas = typeof systemRequestSchemas

describe('system schema type contracts', () => {
  it('system info routes return strings', () => {
    expectTypeOf<z.infer<Schemas['system.get_device_type']['output']>>().toEqualTypeOf<string>()
    expectTypeOf<z.infer<Schemas['system.get_hostname']['output']>>().toEqualTypeOf<string>()
    expectTypeOf<z.infer<Schemas['system.get_cpu_name']['output']>>().toEqualTypeOf<string>()
  })

  it('font and process trust routes infer the declared outputs', () => {
    expectTypeOf<z.infer<Schemas['system.get_fonts']['output']>>().toEqualTypeOf<string[]>()
    expectTypeOf<z.infer<Schemas['system.is_process_trusted']['output']>>().toEqualTypeOf<boolean>()
    expectTypeOf<z.infer<Schemas['system.request_process_trust']['output']>>().toEqualTypeOf<boolean>()
  })
})
