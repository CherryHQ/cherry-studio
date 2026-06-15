import type { GitBashPathInfo } from '@shared/config/constant'
import { describe, expectTypeOf, it } from 'vitest'
import type * as z from 'zod'

import type { terminalRequestSchemas } from '../terminal'

type Schemas = typeof terminalRequestSchemas

describe('terminal schema type contracts', () => {
  it('git bash routes infer the legacy input and output shapes', () => {
    expectTypeOf<z.infer<Schemas['terminal.check_git_bash']['output']>>().toEqualTypeOf<boolean>()
    expectTypeOf<z.infer<Schemas['terminal.get_git_bash_path']['output']>>().toEqualTypeOf<string | null>()
    expectTypeOf<z.infer<Schemas['terminal.get_git_bash_path_info']['output']>>().toEqualTypeOf<GitBashPathInfo>()
    expectTypeOf<z.infer<Schemas['terminal.set_git_bash_path']['input']>>().toEqualTypeOf<string | null>()
    expectTypeOf<z.infer<Schemas['terminal.set_git_bash_path']['output']>>().toEqualTypeOf<boolean>()
  })
})
