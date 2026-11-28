import * as z from 'zod'

import { CodexRequestError, type CodexIncomingRequest, type CodexRequestHandlers } from './appServerClient'
import type { CodexServerReplies } from './protocol'

const decisionSchema = z.union([
  z.enum(['accept', 'acceptForSession', 'decline', 'cancel']),
  z.object({ acceptWithExecpolicyAmendment: z.object({ execpolicy_amendment: z.array(z.string()) }) }),
  z.object({
    applyNetworkPolicyAmendment: z.object({
      network_policy_amendment: z.object({ host: z.string(), action: z.enum(['allow', 'deny']) })
    })
  })
])
type Decision = z.infer<typeof decisionSchema>

interface ApprovalOption {
  optionId: string
  name: string
  decision: 'accept' | 'acceptForSession' | 'acceptAlways' | 'decline' | 'cancel'
  label:
    | 'allow'
    | 'allow_session'
    | 'allow_always_target'
    | 'allow_always_host'
    | 'deny'
    | 'deny_always_host'
    | 'cancel'
  labelTarget?: string
}
export interface CodexApprovalRequest {
  itemId: string
  title: string
  input: Record<string, unknown>
  options: ApprovalOption[]
}
export type Approve = (
  request: CodexApprovalRequest,
  signal: AbortSignal
) => Promise<{ approved: boolean; optionId?: string }>

function option(decision: Decision): ApprovalOption {
  if (typeof decision === 'string') {
    const label = { accept: 'allow', acceptForSession: 'allow_session', decline: 'deny', cancel: 'cancel' } as const
    return {
      optionId: decision,
      name: decision,
      decision,
      label: label[decision]
    }
  }
  if ('acceptWithExecpolicyAmendment' in decision) {
    const command = decision.acceptWithExecpolicyAmendment.execpolicy_amendment.join(' ')
    return {
      optionId: JSON.stringify(decision),
      name: `Always allow: ${command}`,
      decision: 'acceptAlways',
      label: 'allow_always_target',
      labelTarget: command
    }
  }
  const { host, action } = decision.applyNetworkPolicyAmendment.network_policy_amendment
  return {
    optionId: JSON.stringify(decision),
    name: `${action === 'allow' ? 'Always allow' : 'Always deny'} host: ${host}`,
    decision: action === 'allow' ? 'acceptAlways' : 'decline',
    label: action === 'allow' ? 'allow_always_host' : 'deny_always_host',
    labelTarget: host
  }
}

const nativeQuestions = z.array(
  z.object({
    id: z.string(),
    header: z.string(),
    question: z.string(),
    isSecret: z.boolean(),
    isOther: z.boolean(),
    options: z.array(z.object({ label: z.string(), description: z.string() })).nullable()
  })
)
type FormResult = {
  action: 'accept' | 'decline' | 'cancel'
  content?: Record<string, string | number | boolean | string[]>
}
export interface InteractionHost {
  approve: Approve
  question?(
    itemId: string,
    questions: z.output<typeof nativeQuestions>,
    signal: AbortSignal
  ): Promise<readonly { selected: readonly string[]; notes?: string }[]>
  form?(message: string, schema: unknown, signal: AbortSignal): Promise<FormResult>
}
export interface RequestScope {
  signal: AbortSignal
  headless: boolean
  fullAccess: boolean
  knownItems: ReadonlyMap<string, Record<string, unknown>>
  host: InteractionHost
}

const path = z.discriminatedUnion('type', [
  z.object({ type: z.literal('path'), path: z.string() }),
  z.object({ type: z.literal('glob_pattern'), pattern: z.string() }),
  z.object({
    type: z.literal('special'),
    value: z.discriminatedUnion('kind', [
      z.object({ kind: z.enum(['root', 'minimal', 'tmpdir', 'slash_tmp']) }),
      z.object({ kind: z.literal('project_roots'), subpath: z.string().nullable() }),
      z.object({ kind: z.literal('unknown'), path: z.string(), subpath: z.string().nullable() })
    ])
  })
])
const permissionProfile = z.strictObject({
  network: z.strictObject({ enabled: z.boolean().nullable() }).nullish(),
  fileSystem: z
    .strictObject({
      read: z.array(z.string()).nullable().default(null),
      write: z.array(z.string()).nullable().default(null),
      entries: z.array(z.object({ path, access: z.enum(['read', 'write', 'deny']) })).optional(),
      globScanMaxDepth: z.number().int().optional()
    })
    .nullish()
})

async function decision(call: CodexIncomingRequest, scope: RequestScope, file: boolean): Promise<Decision> {
  const { params } = call
  const itemId = z.string().parse(params.itemId)
  if (scope.signal.aborted) return 'cancel'
  if (scope.headless) return 'decline'
  const decisions = z
    .array(file ? z.enum(['accept', 'acceptForSession', 'decline', 'cancel']) : decisionSchema)
    .parse(params.availableDecisions ?? ['accept', 'acceptForSession', 'decline', 'cancel'])
  if (scope.fullAccess && decisions.includes('accept')) return 'accept'
  if (scope.fullAccess && decisions.includes('acceptForSession')) return 'acceptForSession'
  const options = decisions.map(option)
  const answer = await scope.host.approve(
    {
      itemId,
      title: file ? 'Codex: File change' : 'Codex: Command',
      input: { ...scope.knownItems.get(itemId), ...params },
      options
    },
    scope.signal
  )
  if (scope.signal.aborted) return 'cancel'
  const index = options.findIndex(
    (o) => o.optionId === answer.optionId && answer.approved === (o.decision !== 'decline' && o.decision !== 'cancel')
  )
  return decisions[index] ?? (answer.approved && decisions.includes('accept') ? 'accept' : 'decline')
}

export function codexRequestHandlers(
  withScope: <T>(call: CodexIncomingRequest, apply: (scope: RequestScope) => Promise<T>) => Promise<T>
): CodexRequestHandlers {
  return {
    'item/commandExecution/requestApproval': (call) =>
      withScope(call, async (scope) => ({ decision: await decision(call, scope, false) })),
    'item/fileChange/requestApproval': (call) =>
      withScope(call, async (scope) => {
        const selected = await decision(call, scope, true)
        if (typeof selected !== 'string') throw new CodexRequestError('Invalid file approval decision', -32602)
        return { decision: selected }
      }),
    'item/permissions/requestApproval': (call) =>
      withScope(call, async (scope): Promise<CodexServerReplies['item/permissions/requestApproval']> => {
        const { params } = call
        const itemId = z.string().parse(params.itemId)
        const denied = { permissions: {}, scope: 'turn' } as const
        if (scope.headless || scope.signal.aborted) return denied
        const answer = scope.fullAccess
          ? { approved: true, optionId: 'acceptForSession' }
          : await scope.host.approve(
              {
                itemId,
                title: 'Codex: Permissions',
                input: params,
                options: [
                  { ...option('accept'), name: 'Allow' },
                  { ...option('acceptForSession'), name: 'Allow for session' },
                  { ...option('decline'), name: 'Deny' }
                ]
              },
              scope.signal
            )
        if (!answer.approved || scope.signal.aborted) return denied
        const { network, fileSystem } = permissionProfile.parse(params.permissions)
        return {
          permissions: { ...(network && { network }), ...(fileSystem && { fileSystem }) },
          scope: answer.optionId === 'acceptForSession' ? 'session' : 'turn'
        }
      }),
    'item/tool/requestUserInput': (call) =>
      withScope(call, async ({ host, headless, signal }) => {
        const questions = nativeQuestions.parse(call.params.questions)
        if (headless || !host.question || signal.aborted || questions.some((q) => q.isSecret)) return { answers: {} }
        const selections = await host.question(z.string().parse(call.params.itemId), questions, signal)
        if (signal.aborted) return { answers: {} }
        const answers: CodexServerReplies['item/tool/requestUserInput']['answers'] = {}
        for (const [index, question] of questions.entries()) {
          const reply = selections[index]
          if (!reply) continue
          const values: string[] = []
          const choice = question.options?.find(({ label }) => label === reply.selected[0])
          const notes = reply.notes?.trim()
          if (choice) values.push(choice.label)
          if (notes && (choice || question.isOther || !question.options?.length)) {
            if (!choice && question.options?.length) values.push('None of the above')
            values.push(question.options?.length ? 'user_note: ' + notes : notes)
          }
          if (values.length) answers[question.id] = { answers: values }
        }
        return { answers }
      }),
    'mcpServer/elicitation/request': (call) =>
      withScope(
        call,
        async ({ host, headless, signal }): Promise<CodexServerReplies['mcpServer/elicitation/request']> => {
          if (signal.aborted) return { action: 'cancel', content: null, _meta: null }
          if (headless || !host.form || call.params.mode !== 'form')
            return { action: 'decline', content: null, _meta: null }
          const outcome = await host.form(z.string().parse(call.params.message), call.params.requestedSchema, signal)
          return {
            action: signal.aborted ? 'cancel' : outcome.action,
            content: !signal.aborted && outcome.action === 'accept' ? (outcome.content ?? {}) : null,
            _meta: null
          }
        }
      )
  }
}
