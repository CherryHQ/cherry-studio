import * as z from 'zod'

import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'

const nonempty = z.array(z.string().min(1)).min(1)
export const COMMAND_DETECTORS = [
  'builtin-destructive-command',
  'find-deletion',
  'disk-operation',
  'git-discard-worktree',
  'mass-process-termination',
  'service-mutation',
  'container-removal',
  'home-path',
  'privilege-escalation',
  'git-refspec-rewrite',
  'download-to-shell',
  'inline-interpreter',
  'git-executable-configuration'
] as const
const selector = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('command'),
    executables: nonempty,
    subcommands: nonempty.optional(),
    options: z
      .strictObject({ allOf: nonempty.optional(), anyOf: nonempty.optional(), noneOf: nonempty.optional() })
      .optional()
  }),
  z.strictObject({ kind: z.literal('detector'), name: z.enum(COMMAND_DETECTORS) })
])
export const commandPolicySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    revision: z.string().min(1),
    auto: z.strictObject({ defaultDecision: z.literal('allow'), incompleteAnalysisDecision: z.literal('ask') }),
    rules: z
      .array(
        z.strictObject({
          id: z.string().min(1),
          appliesTo: z.strictObject({ builtinRoles: z.array(z.enum(BUILTIN_AGENT_ROLE)).min(1) }).optional(),
          selector,
          effect: z.enum(['ask', 'deny']),
          reasonCode: z.enum([
            ...COMMAND_DETECTORS,
            'permanent-deletion',
            'git-force-push',
            'truncation',
            'recursive-permissions',
            'forced-overwrite',
            'package-publish'
          ])
        })
      )
      .min(1)
  })
  .superRefine((policy, ctx) => {
    if (new Set(policy.rules.map(({ id }) => id)).size !== policy.rules.length)
      ctx.addIssue({ code: 'custom', message: 'Command policy rule IDs must be unique' })
    const mandatory = policy.rules.find(({ id }) => id === 'builtin-destructive-command')
    if (
      !mandatory ||
      mandatory.effect !== 'deny' ||
      mandatory.selector.kind !== 'detector' ||
      mandatory.selector.name !== 'builtin-destructive-command' ||
      Object.values(BUILTIN_AGENT_ROLE).some((role) => !mandatory.appliesTo?.builtinRoles.includes(role))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'The built-in destructive-command denial must protect every built-in role'
      })
  })

export type CommandPolicy = z.infer<typeof commandPolicySchema>
export type CommandPolicyRule = CommandPolicy['rules'][number]
export type CommandSelector = Extract<CommandPolicyRule['selector'], { kind: 'command' }>
