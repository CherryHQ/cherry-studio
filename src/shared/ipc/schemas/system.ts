import type { GitBashPathInfo } from '@shared/types/codeCli'
import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * System IPC schemas — currently only Windows Git Bash discovery/configuration,
 * consumed by the code-CLI runtime. Delegated to `@main/utils/process` +
 * Preference; no events. Git Bash routes are Windows-only (no-op/null elsewhere).
 */

// Mirrors @shared/types/codeCli `GitBashPathInfo`. The `z.ZodType<…>` binding makes
// any shape drift a compile error here rather than in a far-away test.
const gitBashPathInfoSchema: z.ZodType<GitBashPathInfo> = z.object({
  path: z.string().nullable(),
  source: z.enum(['manual', 'auto']).nullable()
})

export const systemRequestSchemas = {
  'system.git_bash.check': defineRoute({ input: z.void(), output: z.boolean() }),
  'system.git_bash.get_path': defineRoute({ input: z.void(), output: z.string().nullable() }),
  'system.git_bash.get_path_info': defineRoute({ input: z.void(), output: gitBashPathInfoSchema }),
  'system.git_bash.set_path': defineRoute({
    input: z.object({ path: z.string().nullable() }),
    output: z.boolean()
  })
}
