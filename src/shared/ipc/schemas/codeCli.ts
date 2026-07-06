import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Code CLI runtime schemas — launch/binary/terminal management.
 * Config injection for file-based CLIs (Claude Code, Codex, OpenCode) is
 * renderer-side; OpenClaw config is written by its own main-process service.
 */
const codeToolsRunResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  command: z.string()
})

const terminalConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  bundleId: z.string().optional()
})

// ── Request schemas ──
export const codeCliRequestSchemas = {
  'code_cli.run': defineRoute({
    input: z.object({
      cliTool: z.string(),
      model: z.string(),
      providerId: z.string(),
      directory: z.string(),
      options: z
        .object({
          autoUpdateToLatest: z.boolean().optional(),
          terminal: z.string().optional(),
          loginFlow: z.boolean().optional(),
          ownLogin: z.boolean().optional()
        })
        .optional()
        .default({})
    }),
    output: codeToolsRunResultSchema
  }),
  'code_cli.get_available_terminals': defineRoute({
    input: z.void(),
    output: z.array(terminalConfigSchema)
  })
}
