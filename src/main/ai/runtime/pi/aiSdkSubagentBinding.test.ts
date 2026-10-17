import { Type } from '@earendil-works/pi-ai'
import { defineTool, type ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { describe, expect, it, onTestFinished } from 'vitest'

import { createAgentRuntimeSession } from '@cherrystudio/agent-runtime-pi'

import { createAiSdkModelBinding } from './aiSdkModelBinding'
import { recordingSubagentPort, routedModel, subagentCall, toolResultOf } from './aiSdkSubagentSupport'
import { finish, MODEL, streamTextPort, tempDir, textParts } from './aiSdkSupport'

/** A tool whose parameters are all optional, so `{}` passes its schema. */
function listFilesTool(calls: unknown[]) {
  return defineTool({
    name: 'list_files',
    label: 'List files',
    description: 'List a directory, the workspace root by default',
    parameters: Type.Object({ path: Type.Optional(Type.String()) }),
    async execute(_id, params) {
      calls.push(params)
      return { content: [{ type: 'text', text: 'a.txt' }], details: undefined }
    }
  })
}

describe('subagent sessions on the AI SDK binding', () => {
  // Breaks when a subagent's session gets only the extensions the host's `configure` returns: the
  // binding's guard is then missing there, and a call with unparsable input runs on `{}`.
  it.each([{ fork: false }, { fork: true }])(
    'never runs a subagent call with unparsable input, nor shows it to approvals (fork: $fork)',
    async ({ fork }) => {
      const listCalls: unknown[] = []
      const asked: string[] = []
      const approvalPrompt: ExtensionFactory = (pi) => {
        pi.on('tool_call', (event) => void asked.push(event.toolCallId))
      }
      const { model } = routedModel(({ userText, lastRole }) => {
        if (userText.includes('TASK-A'))
          return lastRole === 'user'
            ? [
                { type: 'tool-call', toolCallId: 'call_bad', toolName: 'list_files', input: '{"path":"/tm' },
                finish('tool-calls')
              ]
            : [...textParts('r', 'REPORT-A'), finish('stop')]
        return lastRole === 'user'
          ? [subagentCall('call_a', { description: 'List A', prompt: 'TASK-A', fork }), finish('tool-calls')]
          : [...textParts('d', 'Done'), finish('stop')]
      })
      const host = recordingSubagentPort(() => ({ extensionFactories: [approvalPrompt] }))
      // A host that passes the binding on as it is and gives subagents only its approval extension.
      const binding = await createAiSdkModelBinding({
        port: streamTextPort(model).port,
        requestOptions: undefined,
        model: MODEL
      })
      const runtime = await createAgentRuntimeSession({
        ...binding,
        cwd: tempDir('cwd'),
        agentDir: tempDir('agent'),
        systemPrompt: 'You are Cherry.',
        tools: [listFilesTool(listCalls)],
        subagents: host.port
      })
      onTestFinished(() => runtime.dispose())
      const { session } = runtime
      await session.prompt('Delegate')

      expect(listCalls).toEqual([])
      expect(asked).toEqual([])
      const child = host.sessions.get(host.subagents[0].sessionId)!
      expect(toolResultOf(child, 'call_bad')).toMatchObject({ isError: true })
      expect(toolResultOf(session, 'call_a')).toMatchObject({ isError: false })
    }
  )
})
