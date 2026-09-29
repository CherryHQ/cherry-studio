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
let modeValue = 'ask'
const modeOptions = [
  { value: 'ask', name: 'Ask', description: 'Ask before changes' },
  { value: 'plan', name: 'Plan', description: 'Plan before executing' }
]
const mode = () => ({
  id: 'agent-mode',
  name: 'Mode',
  category: 'mode',
  type: 'select',
  currentValue: modeValue,
  options: modeOptions
})
let thoughtValue = 'balanced'
let thoughtPending = false
const thought = () => ({
  id: 'reasoning-budget',
  name: 'Reasoning',
  category: 'thought_level',
  type: 'select',
  currentValue: thoughtValue,
  options: [
    {
      group: 'levels',
      name: 'Levels',
      options: [
        { value: 'balanced', name: 'Balanced' },
        { value: 'deep', name: 'Deep' }
      ]
    }
  ]
})
let promptId
const finish = () => {
  if (protocol === 'acp')
    reply(promptId, {
      stopReason: scenario.startsWith('stop:') ? scenario.slice(5) : scenario === 'cancel' ? 'cancelled' : 'end_turn',
      ...(scenario === 'usage'
        ? {
            usage:
              turn === 1
                ? {
                    inputTokens: 100,
                    outputTokens: 20,
                    totalTokens: 175,
                    thoughtTokens: 5,
                    cachedReadTokens: 40,
                    cachedWriteTokens: 10
                  }
                : { inputTokens: 3, outputTokens: 2, totalTokens: 5 }
          }
        : {})
    })
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
            agentInfo: { name: 'fixture', version: '1.0' },
            agentCapabilities: {
              loadSession: scenario !== 'no-resume',
              promptCapabilities: {
                image: scenario !== 'no-images',
                ...(scenario === 'embedded-files' ? { embeddedContext: true } : {})
              }
            },
            authMethods: scenario.startsWith('auth-') ? [{ id: 'oauth-personal', name: 'Google' }] : []
          }
        : { userAgent: 'fixture' }
    )
  } else if (method === 'authenticate') {
    if (scenario === 'auth-pending') return
    if (scenario === 'auth-rejected' || scenario === 'auth-secret') {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32000,
            message:
              scenario === 'auth-secret'
                ? `Rejected ${process.env.GEMINI_API_KEY}`
                : 'Account is not available in your location'
          }
        }) + '\n'
      )
    } else reply(id, {})
  } else if (method === 'session/new' || method === 'session/load') {
    cwd = message.params.cwd
    if (method === 'session/load') {
      text('REPLAY MUST NOT APPEAR')
      update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'REPLAY THOUGHT' } })
      update({ sessionUpdate: 'plan', entries: [{ content: 'REPLAY PLAN', priority: 'low', status: 'pending' }] })
    }
    if (scenario === 'initial-updates') {
      update({
        sessionUpdate: 'available_commands_update',
        availableCommands: [{ name: 'review', description: 'Review code' }]
      })
      emit({
        method: 'session/update',
        params: {
          sessionId: 'unrelated',
          update: {
            sessionUpdate: 'available_commands_update',
            availableCommands: [{ name: 'wrong', description: 'Wrong session' }]
          }
        }
      })
      update({
        sessionUpdate: 'config_option_update',
        configOptions: [
          {
            id: 'model',
            category: 'model',
            name: 'Model',
            type: 'select',
            currentValue: 'updated-model',
            options: [{ value: 'updated-model', name: 'Updated model' }]
          }
        ]
      })
    }
    reply(id, {
      ...(scenario === 'legacy-models' || scenario === 'both-models'
        ? {
            models: {
              currentModelId: 'legacy-default',
              availableModels: [{ modelId: 'legacy-model', name: 'Legacy model' }]
            }
          }
        : {}),
      ...(scenario === 'mode-legacy' || scenario === 'mode-both'
        ? {
            modes: {
              currentModeId: 'ask',
              availableModes: modeOptions.map(({ value, ...option }) => ({ id: value, ...option }))
            }
          }
        : {}),
      sessionId: 'native-session',
      configOptions:
        scenario === 'no-models' || scenario === 'legacy-models'
          ? []
          : [
              ...(scenario.startsWith('mode') && scenario !== 'mode-legacy' ? [mode()] : []),
              ...(scenario.startsWith('thought') ? [thought()] : []),
              {
                id: 'model',
                category: 'model',
                name: 'Model',
                type: 'select',
                currentValue: scenario === 'thought-resume' ? 'fixture-model' : 'fixture-default',
                options: [{ value: 'fixture-model', name: 'Fixture model' }]
              }
            ]
    })
  } else if (method === 'session/set_mode') {
    modeValue = message.params.modeId
    update({ sessionUpdate: 'current_mode_update', currentModeId: modeValue })
    reply(id, {})
  } else if (method === 'session/set_config_option') {
    if (message.params.configId === 'agent-mode') {
      if (scenario === 'mode-error') return emit({ id, error: { code: -32602, message: 'Mode unavailable' } })
      modeValue = message.params.value
      return reply(id, { configOptions: scenario === 'mode-removed' ? [] : [mode()] })
    }
    if (message.params.configId === 'reasoning-budget') {
      if (scenario === 'thought-error') return emit({ id, error: { code: -32602, message: 'Reasoning unavailable' } })
      if (scenario === 'thought-delayed') {
        thoughtPending = true
        return setTimeout(() => {
          thoughtValue = message.params.value
          thoughtPending = false
          reply(id, { configOptions: [thought()] })
        }, 40)
      }
      thoughtValue = message.params.value
      return reply(id, { configOptions: scenario === 'thought-removed' ? [] : [thought()] })
    }
    reply(id, {
      configOptions: [
        {
          id: 'model',
          category: 'model',
          name: 'Model',
          type: 'select',
          currentValue: message.params.value,
          options: [{ value: 'fixture-model', name: 'Fixture model' }]
        }
      ]
    })
  } else if (method === 'model/list') {
    reply(id, { data: [{ id: 'fixture-model', displayName: 'Fixture model' }], nextCursor: null })
  } else if (method === 'thread/start' || method === 'thread/resume') {
    reply(id, { thread: { id: 'native-session' }, model: 'fixture-model' })
  } else if (method === 'session/prompt' || method === 'turn/start') {
    if (thoughtPending)
      return emit({ id, error: { code: -32603, message: 'Prompt arrived before configuration settled' } })
    promptId = id
    turn++
    if (protocol === 'codex') {
      reply(id, { turn: { id: 'turn', status: 'inProgress' } })
      emit({ method: 'turn/started', params: { threadId: 'native-session', turn: { id: 'turn' } } })
    }
    text(`turn ${turn}: `)
    if (scenario === 'rich-cancel') {
      update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Still thinking' } })
      return
    }
    if (scenario === 'rich-output') {
      update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Inspect first' } })
      update({ sessionUpdate: 'plan', entries: [{ content: 'Inspect', priority: 'high', status: 'in_progress' }] })
      update({
        sessionUpdate: 'tool_call',
        toolCallId: 'edit',
        title: 'Edit example',
        kind: 'edit',
        status: 'pending',
        rawInput: { path: '/example' }
      })
      update({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'edit',
        status: 'in_progress',
        locations: [{ path: '/example', line: 2 }],
        content: [{ type: 'diff', path: '/example', oldText: 'old', newText: 'new' }]
      })
      update({ sessionUpdate: 'tool_call_update', toolCallId: 'edit', status: 'completed', rawInput: null })
      update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Then answer' } })
      update({ sessionUpdate: 'plan', entries: [{ content: 'Inspect', priority: 'high', status: 'completed' }] })
      text('Done')
      finish()
      return
    }
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
    update({
      sessionUpdate: 'tool_call',
      toolCallId: 'terminal-tool',
      title: 'Run terminal',
      kind: 'execute',
      status: 'in_progress',
      content: [{ type: 'terminal', terminalId }]
    })
    emit({ id: 'terminal-wait', method: 'terminal/wait_for_exit', params: { sessionId: 'native-session', terminalId } })
  } else if (id === 'terminal-wait') {
    emit({ id: 'terminal-output', method: 'terminal/output', params: { sessionId: 'native-session', terminalId } })
  } else if (id === 'terminal-output') {
    text(message.result.output)
    emit({ id: 'terminal-release', method: 'terminal/release', params: { sessionId: 'native-session', terminalId } })
  } else if (id === 'terminal-release') {
    update({ sessionUpdate: 'tool_call_update', toolCallId: 'terminal-tool', status: 'completed' })
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
