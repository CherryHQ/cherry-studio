import type { GitBashPathInfo } from '@shared/config/constant'
import * as z from 'zod'

import { defineRoute } from '../define'

const gitBashPathInfoSchema: z.ZodType<GitBashPathInfo> = z.object({
  path: z.string().nullable(),
  source: z.enum(['manual', 'auto']).nullable()
})

// ── Request: renderer→main terminal/toolchain capability calls (zod values, always parsed) ──
export const terminalRequestSchemas = {
  'terminal.check_git_bash': defineRoute({ input: z.void(), output: z.boolean() }),
  'terminal.get_git_bash_path': defineRoute({ input: z.void(), output: z.string().nullable() }),
  'terminal.get_git_bash_path_info': defineRoute({ input: z.void(), output: gitBashPathInfoSchema }),
  'terminal.set_git_bash_path': defineRoute({ input: z.string().nullable(), output: z.boolean() })
}
