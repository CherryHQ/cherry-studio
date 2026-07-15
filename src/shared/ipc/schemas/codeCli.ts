import { CodeCli } from '@shared/types/codeCli'
import { CLI_CONFIG_TARGET_IDS, FILE_CONFIGURED_CLI_TOOL_IDS } from '@shared/utils/cliConfig'
import * as z from 'zod'

import { defineRoute } from '../define'
import { operationResultSchema } from './common'

/**
 * Code CLI runtime schemas — launch/binary/terminal management plus the config
 * write boundary. File-based CLIs (Claude Code, Codex, OpenCode, Gemini, Qwen,
 * Kimi) build config drafts renderer-side and persist them through
 * code_cli.write_config; OpenClaw config is written by its own main-process
 * service.
 */
const terminalConfigSchema = z.object({
  id: z.string(),
  name: z.string()
})

const runBaseSchema = z.object({
  cliTool: z.enum(CodeCli),
  // Plain string on purpose: the service owns the friendly "Directory does not
  // exist" message; a zod floor would reroute empty input to a router error.
  directory: z.string(),
  terminal: z.string().optional()
})

const codeCliRunInputSchema = z.discriminatedUnion('mode', [
  // Launch with a Cherry-injected provider/model.
  runBaseSchema.extend({
    mode: z.literal('normal'),
    providerId: z.string().min(1),
    model: z.string().min(1),
    // Gateway launch: the CLI runs against the local API gateway, which addresses
    // models as `providerId:modelId`. Only gemini-cli consumes this flag — it passes the
    // gateway address on the command line, where `--model` outranks settings.model.name and
    // rides past gemini-cli's flash-name normalization; the other tools carry gateway
    // addressing in their own config and ignore it.
    gateway: z.boolean().optional()
  }),
  // Claude-only `/login` flow (ClaudeCodeSettings).
  runBaseSchema.extend({
    mode: z.literal('login-flow'),
    cliTool: z.literal(CodeCli.CLAUDE_CODE)
  }),
  // Launch with no injected provider: the tool's own stored login (login-capable
  // CLIs) and providerless CLIs (qoder/copilot) both send this shape.
  runBaseSchema.extend({
    mode: z.literal('own-login')
  })
])

export type CodeCliRunInput = z.infer<typeof codeCliRunInputSchema>

// ── Request schemas ──
export const codeCliRequestSchemas = {
  'code_cli.run': defineRoute({
    input: codeCliRunInputSchema,
    output: operationResultSchema
  }),
  'code_cli.write_config': defineRoute({
    // Targets, not paths: the enum is the write allow-list, and main resolves
    // each target to its spec path itself — a compromised renderer cannot point
    // this route at an arbitrary file.
    input: z.object({
      cliTool: z.enum(FILE_CONFIGURED_CLI_TOOL_IDS),
      files: z
        .array(
          z.object({
            target: z.enum(CLI_CONFIG_TARGET_IDS),
            content: z.string().max(1024 * 1024)
          })
        )
        .min(1)
    }),
    output: operationResultSchema
  }),
  'code_cli.get_available_terminals': defineRoute({
    input: z.void(),
    output: z.array(terminalConfigSchema)
  })
}
