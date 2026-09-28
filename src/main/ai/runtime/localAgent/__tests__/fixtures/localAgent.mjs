import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const protocol = process.argv[2]
const scenario = process.argv[3]
const emit = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
const reply = (id, result) => emit({ id, result })
const update = (value) => emit({ method: 'session/update', params: { sessionId: 'native-session', update: value } })
const text = (value) =>
  protocol === 'acp'
    ? update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: value } })
    : emit({
        method: 'item/agentMessage/delta',
        params: { threadId: 'native-session', itemId: 'answer', delta: value }
      })
let turn = 0
let cwd
let terminalId
let promptId
const finish = () => {
  if (protocol === 'acp') reply(promptId, { stopReason: 'end_turn' })
  else
    emit({
      method: 'turn/completed',
      params: { threadId: 'native-session', turn: { id: 'turn', status: 'completed', error: null } }
    })
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (process.env.FIXTURE_LOG) appendFileSync(process.env.FIXTURE_LOG, `${line}\n`)
  const { id, method } = message
  if (method === 'initialize') {
    reply(
      id,
      protocol === 'acp'
        ? {
            protocolVersion: 1,
            agentCapabilities: { loadSession: scenario !== 'no-resume', promptCapabilities: { image: true } },
            authMethods: []
          }
        : { userAgent: 'fixture' }
    )
  } else if (method === 'session/new' || method === 'session/load') {
    cwd = message.params.cwd
    if (method === 'session/load') text('REPLAY MUST NOT APPEAR')
    reply(id, {
      sessionId: 'native-session',
      configOptions: [
        {
          id: 'model',
          category: 'model',
          name: 'Model',
          type: 'select',
          currentValue: 'fixture-model',
          options: [{ value: 'fixture-model', name: 'Fixture model' }]
        }
      ]
    })
  } else if (method === 'model/list') {
    reply(id, { data: [{ id: 'fixture-model', displayName: 'Fixture model' }], nextCursor: null })
  } else if (method === 'thread/start' || method === 'thread/resume') {
    reply(id, { thread: { id: 'native-session' }, model: 'fixture-model' })
  } else if (method === 'session/prompt' || method === 'turn/start') {
    promptId = id
    turn++
    if (protocol === 'codex') {
      reply(id, { turn: { id: 'turn', status: 'inProgress' } })
      emit({ method: 'turn/started', params: { threadId: 'native-session', turn: { id: 'turn' } } })
    }
    text(`turn ${turn}: `)
    if (scenario === 'crash') process.exit(7)
    if (scenario === 'cancel') return
    if (scenario === 'cursor-question' || scenario === 'cursor-plan') {
      emit({
        id: 'cursor-extension',
        method: scenario === 'cursor-question' ? 'cursor/ask_question' : 'cursor/create_plan',
        params:
          scenario === 'cursor-question'
            ? {
                toolCallId: 'question-tool',
                title: 'Select features',
                questions: [
                  {
                    id: 'features',
                    prompt: 'Choose features',
                    allowMultiple: true,
                    options: [
                      { id: 'one', label: 'Same, label' },
                      { id: 'two', label: 'Same, label' }
                    ]
                  }
                ]
              }
            : { toolCallId: 'plan-tool', name: 'Review plan', plan: '## Plan\nWrite only approved files.', todos: [] }
      })
      return
    }
    if (scenario === 'callbacks') {
      emit({
        id: 'write-file',
        method: 'fs/write_text_file',
        params: { sessionId: 'native-session', path: `${cwd}/callback.txt`, content: 'line1\nline2\nline3' }
      })
      return
    }
    if (scenario === 'permission' || scenario === 'standalone-permission') {
      if (protocol === 'acp') {
        if (scenario !== 'standalone-permission')
          update({
            sessionUpdate: 'tool_call',
            toolCallId: 'tool',
            title: 'Write file',
            status: 'pending',
            rawInput: { path: '/example' }
          })
        emit({
          id: 'approval',
          method: 'session/request_permission',
          params: {
            sessionId: 'native-session',
            toolCall: { toolCallId: 'tool', title: 'Write file' },
            options: [
              { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
              { optionId: 'always', name: 'Allow for session', kind: 'allow_always' },
              { optionId: 'deny', name: 'Deny', kind: 'reject_once' }
            ]
          }
        })
      } else
        emit({
          id: 'approval',
          method: 'item/commandExecution/requestApproval',
          params: { threadId: 'native-session', turnId: 'turn', itemId: 'tool', command: 'echo fixture' }
        })
    } else {
      text('hello')
      finish()
    }
  } else if (id === 'cursor-extension') {
    text(JSON.stringify(message.result ?? message.error))
    finish()
  } else if (id === 'write-file') {
    emit({
      id: 'read-file',
      method: 'fs/read_text_file',
      params: { sessionId: 'native-session', path: `${cwd}/callback.txt`, line: 2, limit: 1 }
    })
  } else if (id === 'read-file') {
    text(message.result.content)
    emit({
      id: 'terminal-create',
      method: 'terminal/create',
      params: {
        sessionId: 'native-session',
        command: process.execPath,
        args: ['-e', 'process.stdout.write("terminal-result")'],
        outputByteLimit: 1024
      }
    })
  } else if (id === 'terminal-create') {
    terminalId = message.result.terminalId
    emit({ id: 'terminal-wait', method: 'terminal/wait_for_exit', params: { sessionId: 'native-session', terminalId } })
  } else if (id === 'terminal-wait') {
    emit({ id: 'terminal-output', method: 'terminal/output', params: { sessionId: 'native-session', terminalId } })
  } else if (id === 'terminal-output') {
    text(message.result.output)
    emit({ id: 'terminal-release', method: 'terminal/release', params: { sessionId: 'native-session', terminalId } })
  } else if (id === 'terminal-release') {
    finish()
  } else if (id === 'approval') {
    text(JSON.stringify(message.result))
    if (protocol === 'acp' && scenario !== 'standalone-permission')
      update({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool',
        status: 'completed',
        rawOutput: 'permission handled'
      })
    finish()
  } else if (method === 'session/cancel' || method === 'turn/interrupt') {
    if (id) reply(id, {})
    finish()
  } else if (id) reply(id, {})
})
