import { appendFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { createInterface } from 'node:readline'

const protocol = process.argv[2]
const scenario = process.argv[3]
const configuredModel = {
  'provider-qwen': 'deepseek/deepseek-flash(openai)',
  'provider-hermes': 'custom:deepseek/deepseek-flash',
  'provider-minimax': 'm:custom_provider%3Acherry-CherryIN:deepseek%2Fdeepseek-flash:v:',
  'acp-usage-zero-size': 'google/gemini-4-neon',
  'acp-usage-prompt-fallback': 'claude-sonnet-4-6'
}[scenario]
const fixtureModelOption = {
  value: configuredModel ?? 'fixture-model',
  name: 'Fixture model',
  ...(scenario === 'both-models' && {
    description: 'Live model description',
    _meta: { fixture: { modalities: ['image'] } }
  })
}
if (process.env.FIXTURE_LOG) {
  writeFileSync(`${process.env.FIXTURE_LOG}.pid`, String(process.pid))
  writeFileSync(`${process.env.FIXTURE_LOG}.argv.json`, JSON.stringify(process.argv))
}
const emit = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
const reply = (id, result) => emit({ id, result })
const update = (value) => emit({ method: 'session/update', params: { sessionId: 'native-session', update: value } })
const callbacks = new Map()
let callbackId = 0
const requestClient = (method, params) =>
  new Promise((resolve) => {
    const id = `callback-${++callbackId}`
    callbacks.set(id, resolve)
    emit({ id, method, params })
  })
const text = (value) =>
  protocol === 'acp'
    ? update({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: value }
      })
    : emit({
        method: 'item/agentMessage/delta',
        params: { threadId: 'native-session', itemId: 'answer', delta: value }
      })
const piBanner = 'pi v0.84.2\nUpdate available\n'
let turn = 0
let cwd
let terminalId
let modeValue = scenario.startsWith('acp-policy-') ? 'default' : 'ask'
const modeOptions = scenario.startsWith('acp-policy-')
  ? [
      { value: 'default', name: 'Default', description: 'Ask before changes' },
      { value: 'accept-edits', name: 'Accept Edits', description: 'Auto-approve workspace edits' },
      ...(scenario === 'acp-policy-plan' ? [{ value: 'plan', name: 'Plan', description: 'Read only' }] : []),
      { value: 'auto', name: 'Auto', description: 'Model-managed permissions' },
      { value: 'yolo', name: 'Full Access', description: 'Bypass all permissions' }
    ]
  : [
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
  id: scenario === 'thought-uncategorized' ? 'effort' : 'reasoning-budget',
  name: 'Reasoning',
  category:
    scenario === 'thought-uncategorized' ? undefined : scenario === 'thought-thinking' ? 'thinking' : 'thought_level',
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
let verbosity = 'brief'
let notifications = false
const extraConfig = () => [
  {
    id: 'verbosity',
    name: 'Answer detail',
    description: 'Response length',
    category: '_verbosity',
    type: 'select',
    currentValue: verbosity,
    options: [
      {
        group: 'detail',
        name: 'Detail levels',
        options: [
          { value: 'brief', name: 'Brief' },
          { value: 'verbose', name: 'Detailed', description: 'Include explanation' }
        ]
      }
    ]
  },
  { id: 'notifications', name: 'Notifications', type: 'boolean', currentValue: notifications }
]
const secondaryValues = {}
const copilotModes = () => [
  {
    id: 'mode',
    name: 'Mode',
    category: 'mode',
    type: 'select',
    currentValue: secondaryValues.mode ?? 'https://agentclientprotocol.com/protocol/session-modes#agent',
    options: ['agent', 'plan', 'autopilot'].map((name) => ({
      name,
      value: `https://agentclientprotocol.com/protocol/session-modes#${name}`
    }))
  },
  {
    id: 'allow_all',
    name: 'Permissions',
    type: 'select',
    currentValue: secondaryValues.allow_all ?? 'off',
    options: ['off', 'auto', 'on'].map((value) => ({ value, name: value }))
  }
]
const junieModes = () => [
  {
    id: 'mode',
    name: 'Mode',
    type: 'select',
    currentValue: secondaryValues.mode ?? 'default',
    options: ['default', 'plan'].map((value) => ({ value, name: value }))
  },
  {
    id: 'brave_mode',
    name: 'Brave Mode',
    category: 'mode',
    type: 'select',
    currentValue: secondaryValues.brave_mode ?? 'brave-auto',
    options: ['brave-auto', 'on', 'off'].map((value) => ({ value, name: value }))
  }
]
const minimaxApprovals = () => [
  {
    id: 'permissionMode',
    name: 'Permission mode',
    category: '_permission',
    type: 'select',
    currentValue: secondaryValues.permissionMode ?? 'auto',
    options: ['default', 'auto', 'bypassPermissions'].map((value) => ({ value, name: value }))
  }
]
const nativeMode = (values, current = values[0]) => ({
  id: 'mode',
  name: 'Mode',
  type: 'select',
  category: 'mode',
  currentValue: secondaryValues.mode ?? current,
  options: values.map((value) => ({ value, name: value }))
})
const nativePermissionOptions = {
  'amp-native-permissions': () => [
    {
      ...nativeMode(['local', 'orb']),
      id: 'execution-environment',
      currentValue: secondaryValues['execution-environment'] ?? 'local'
    },
    { ...nativeMode(['default', 'bypass']), id: 'permission', currentValue: secondaryValues.permission ?? 'default' }
  ],
  'antigravity-native-permissions': () => [nativeMode(['default', 'accept-edits', 'auto', 'plan'])],
  'cline-native-permissions': () => [
    nativeMode(['act', 'plan']),
    {
      id: 'auto_approve',
      name: 'Auto-approve tools',
      type: 'boolean',
      currentValue: secondaryValues.auto_approve ?? false
    }
  ],
  'devin-native-permissions': () => [nativeMode(['accept-edits', 'smart', 'ask', 'plan', 'bypass'], 'ask')],
  'kilo-native-permissions': () => [nativeMode(['code', 'ask', 'debug', 'orchestrator', 'plan'])],
  'kiro-native-permissions': () => [
    nativeMode(['vibe', 'spec', 'plan']),
    {
      id: 'autopilot',
      name: 'Autonomy',
      type: 'select',
      currentValue: secondaryValues.autopilot ?? 'on',
      options: [
        { value: 'on', name: 'Autopilot' },
        { value: 'off', name: 'Supervised' }
      ]
    },
    {
      id: 'memoryReflection',
      name: 'Memory reflection',
      type: 'select',
      currentValue: secondaryValues.memoryReflection ?? 'off',
      options: [
        { value: 'off', name: 'Off' },
        { value: 'on', name: 'On' }
      ]
    },
    {
      id: 'contentCollection',
      name: 'Content collection',
      type: 'select',
      currentValue: 'enabled',
      options: [
        { value: 'enabled', name: 'Enabled' },
        { value: 'disabled', name: 'Disabled' }
      ]
    }
  ],
  'kimi-native-permissions': () => [nativeMode(['default', 'auto', 'plan', 'yolo'])],
  'qwen-native-permissions': () => [nativeMode(['default', 'auto-edit', 'auto', 'plan', 'yolo'])],
  'muse-native-permissions': () => [nativeMode(['onRequest', 'promptUnmatched', 'denyUnmatched', 'allowAll'])],
  'copilot-native-permissions': copilotModes,
  'junie-native-permissions': junieModes,
  'minimax-native-permissions': minimaxApprovals
}
const multipleConfig = () => {
  const model = {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: 'fixture-model',
    options: [
      { value: 'fixture-model', name: 'Fixture model' },
      { value: 'other-model', name: 'Other model' }
    ]
  }
  return [
    mode(),
    thought(),
    model,
    { ...mode(), id: 'secondary-mode', currentValue: secondaryValues['secondary-mode'] ?? 'ask' },
    { ...thought(), id: 'secondary-thought', currentValue: secondaryValues['secondary-thought'] ?? 'balanced' },
    { ...model, id: 'secondary-model', currentValue: secondaryValues['secondary-model'] ?? 'fixture-model' },
    ...extraConfig()
  ]
}
const semanticConfig = () => [
  extraConfig()[0],
  thought(),
  multipleConfig()[2],
  {
    id: 'context-size',
    name: 'Context size',
    category: 'model_config',
    type: 'select',
    currentValue: 'small',
    options: [
      { value: 'small', name: 'Small' },
      { value: 'large', name: 'Large' }
    ]
  },
  mode(),
  { id: 'future-option', name: 'Future', type: 'future', currentValue: 'default' },
  extraConfig()[1]
]
let promptId
let previousGrokPromptId
const finish = (turnId = 'turn') => {
  if (protocol === 'acp')
    reply(promptId, {
      stopReason: scenario.startsWith('stop:') ? scenario.slice(5) : scenario === 'cancel' ? 'cancelled' : 'end_turn',
      ...(scenario === 'usage' || scenario === 'acp-usage-prompt-fallback'
        ? {
            usage:
              turn === 1
                ? {
                    inputTokens: 100,
                    outputTokens: 20,
                    totalTokens: 120,
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
      params: {
        threadId: 'native-session',
        turn: {
          id: turnId,
          status: scenario === 'interrupted' || scenario === 'cancel' ? 'interrupted' : 'completed',
          error: null
        }
      }
    })
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (process.env.FIXTURE_LOG) appendFileSync(process.env.FIXTURE_LOG, `${line}\n`)
  const { id, method } = message
  if (callbacks.has(id)) {
    callbacks.get(id)(message)
    callbacks.delete(id)
    return
  }
  if (method === 'initialize') {
    if (scenario === 'startup-error') {
      process.stderr.write('Missing native backend; API_KEY=fixture-secret')
      process.exit(1)
    }
    if (scenario.startsWith('compaction') && !message.params.clientCapabilities?.session?.compaction)
      return emit({ id, error: { code: -32602, message: 'Compaction capability required' } })
    if (scenario === 'config-extra' && !message.params.clientCapabilities?.session?.configOptions?.boolean)
      return emit({ id, error: { code: -32602, message: 'Boolean capability required' } })
    if (scenario === 'notices' && !message.params.clientCapabilities?.session?.notices)
      return emit({ id, error: { code: -32602, message: 'Notice capability required' } })
    reply(
      id,
      protocol === 'acp'
        ? {
            protocolVersion: 1,
            agentInfo: { name: 'fixture', version: '1.0' },
            agentCapabilities: {
              loadSession: scenario !== 'no-resume' && scenario !== 'resume-only',
              ...(scenario === 'acp-http-mcp' ? { mcpCapabilities: { http: true } } : {}),
              ...(scenario.startsWith('resume') || scenario.startsWith('close')
                ? {
                    sessionCapabilities: {
                      ...(scenario.startsWith('resume') ? { resume: scenario === 'resume-null' ? null : {} } : {}),
                      ...(scenario.startsWith('close') ? { close: scenario === 'close-null' ? null : {} } : {})
                    }
                  }
                : {}),
              promptCapabilities: {
                image: scenario !== 'no-images',
                ...(scenario === 'audio' ? { audio: true } : {}),
                ...(scenario === 'embedded-files' ? { embeddedContext: true } : {})
              }
            },
            authMethods: scenario.startsWith('auth-')
              ? [
                  {
                    id: 'oauth-personal',
                    name: 'Google',
                    ...(scenario === 'auth-terminal' ? { type: 'terminal', args: ['--login'] } : {}),
                    ...(scenario === 'auth-legacy-terminal'
                      ? { _meta: { 'terminal-auth': { command: 'fixture' } } }
                      : {})
                  }
                ]
              : []
          }
        : { userAgent: 'fixture' }
    )
  } else if (method === 'authenticate') {
    if (scenario === 'auth-pending') return
    if (scenario === 'auth-rejected' || scenario === 'auth-secret') {
      return emit({
        id,
        error: {
          code: -32000,
          message:
            scenario === 'auth-secret' ? `Rejected ${process.env.GEMINI_API_KEY}` : 'not available in your location'
        }
      })
    }
    reply(id, {})
  } else if (method === 'session/new' || method === 'session/load' || method === 'session/resume') {
    if (
      method === 'session/resume' &&
      (scenario === 'resume-error' || (scenario === 'resume-lost' && message.params.sessionId === 'lost-thread'))
    ) {
      return emit({ id, error: { code: -32603, message: 'Native session was not found' } })
    }
    cwd = message.params.cwd
    if (scenario === 'pi-startup-early') text(piBanner)
    if (method === 'session/load') {
      if (scenario.startsWith('compaction'))
        update({ sessionUpdate: 'compaction_update', compactionId: 'historical', status: 'in_progress' })
      text('REPLAY MUST NOT APPEAR')
      update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'REPLAY THOUGHT' } })
      update({ sessionUpdate: 'plan', entries: [{ content: 'REPLAY PLAN', priority: 'low', status: 'pending' }] })
    }
    if (scenario === 'notices') {
      update({ sessionUpdate: 'notice', severity: 'warning', title: 'Quota low', description: 'Check account' })
      update({ sessionUpdate: 'notice', severity: 'error', title: 'Connection degraded' })
      update({ sessionUpdate: 'notice', severity: 'custom', title: 'Agent information' })
      emit({
        method: 'session/update',
        params: {
          sessionId: 'unrelated',
          update: { sessionUpdate: 'notice', severity: 'error', title: 'Wrong session' }
        }
      })
    }
    if (scenario === 'openclaw-title') {
      update({ sessionUpdate: 'session_info_update', title: 'agent:main:acp-bridge:native-session' })
      update({ sessionUpdate: 'session_info_update', title: 'acp-bridge:native-session' })
      update({ sessionUpdate: 'session_info_update', title: '[Working directory: ~/project…' })
      update({ sessionUpdate: 'session_info_update', title: 'Explain the project' })
    }
    if (scenario === 'session-title') {
      update({ sessionUpdate: 'session_info_update', title: 'Native initial title' })
      emit({
        method: 'session/update',
        params: { sessionId: 'unrelated', update: { sessionUpdate: 'session_info_update', title: 'Wrong title' } }
      })
    }
    if (scenario === 'session-cost') {
      update({
        sessionUpdate: 'usage_update',
        used: 20,
        size: 100,
        cost: { amount: 0.4, currency: 'EUR', _meta: { extra: true } }
      })
    }
    if (scenario === 'context-usage') {
      update({ sessionUpdate: 'usage_update', used: 20, size: 100 })
      emit({
        method: 'session/update',
        params: {
          sessionId: 'unrelated',
          update: { sessionUpdate: 'usage_update', used: 99, size: 100 }
        }
      })
    }
    if (scenario === 'initial-updates' || scenario === 'close-management-catalog' || scenario.startsWith('resume')) {
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
          ...(scenario.startsWith('resume') ? [mode(), thought()] : []),
          ...(scenario === 'close-management-catalog' ? [thought()] : []),
          {
            id: 'model',
            category: 'model',
            name: 'Model',
            type: 'select',
            currentValue: 'updated-model',
            options: [
              {
                value: 'updated-model',
                name: 'Updated model',
                description: 'Updated model description',
                _meta: { fixture: { modalities: ['text', 'image'] } }
              },
              ...(scenario === 'close-management-catalog'
                ? [{ value: 'alternate-model', name: 'Alternate model' }]
                : [])
            ]
          }
        ]
      })
    }
    if (scenario === 'close-management-catalog') {
      emit({
        method: 'session/update',
        params: { sessionId: 'unrelated', update: { sessionUpdate: 'config_option_update', configOptions: [] } }
      })
    }
    reply(id, {
      ...(scenario === 'grok-legacy-effort'
        ? {
            models: {
              currentModelId: 'grok-reasoning',
              availableModels: [
                {
                  modelId: 'grok-reasoning',
                  name: 'Grok Reasoning',
                  _meta: {
                    reasoningEffort: 'medium',
                    reasoningEfforts: [
                      { id: 'medium', value: 'medium', label: 'Medium' },
                      { id: 'xhigh', value: 'xhigh', label: 'Extra high' }
                    ]
                  }
                },
                { modelId: 'grok-basic', name: 'Grok Basic', _meta: { supportsReasoningEffort: false } }
              ]
            }
          }
        : {}),
      ...(scenario === 'legacy-models' || scenario === 'both-models'
        ? {
            models: {
              currentModelId: 'legacy-default',
              availableModels: [
                {
                  modelId: 'legacy-model',
                  name: 'Legacy model',
                  description: 'Legacy model description',
                  _meta: { fixture: { modalities: ['text'] } }
                }
              ]
            }
          }
        : {}),
      ...(scenario.startsWith('mode-legacy') || scenario === 'mode-both'
        ? {
            modes: {
              currentModeId: 'ask',
              availableModes: modeOptions.map(({ value, ...option }) => ({ id: value, ...option }))
            }
          }
        : {}),
      ...(scenario === 'minimax-native-permissions'
        ? { modes: { currentModeId: 'default', availableModes: ['default', 'plan'].map((id) => ({ id, name: id })) } }
        : {}),
      ...(scenario.startsWith('thought-legacy')
        ? {
            modes: {
              currentModeId: thoughtValue,
              availableModes: thought().options[0].options.map(({ value, name }) => ({
                id: value,
                name: scenario === 'thought-legacy-distinct' ? `Permission: ${name}` : name
              }))
            }
          }
        : {}),
      sessionId: 'native-session',
      ...(scenario.startsWith('pi-startup') && scenario !== 'pi-startup-missing' && method === 'session/new'
        ? { _meta: { piAcp: { startupInfo: piBanner } } }
        : {}),
      configOptions:
        nativePermissionOptions[scenario]?.() ??
        (scenario === 'config-semantics'
          ? semanticConfig()
          : scenario === 'config-multiple'
            ? multipleConfig()
            : scenario === 'mode-legacy' ||
                scenario === 'grok-legacy-effort' ||
                scenario === 'thought-legacy-only' ||
                scenario.startsWith('mode-legacy-upgrade')
              ? undefined
              : scenario === 'mode-legacy-null'
                ? null
                : scenario === 'mode-legacy-empty' ||
                    scenario === 'no-models' ||
                    scenario === 'legacy-models' ||
                    scenario === 'initial-updates'
                  ? []
                  : [
                      ...((scenario.startsWith('mode') && scenario !== 'mode-legacy') ||
                      scenario.startsWith('resume') ||
                      scenario.startsWith('acp-policy-')
                        ? [mode()]
                        : []),
                      ...(scenario.startsWith('thought') || scenario.startsWith('resume') ? [thought()] : []),
                      ...(scenario.startsWith('config') ? extraConfig() : []),
                      {
                        id: 'model',
                        category: 'model',
                        name: 'Model',
                        type: 'select',
                        currentValue:
                          scenario === 'thought-resume'
                            ? 'fixture-model'
                            : scenario === 'acp-usage-zero-size'
                              ? 'google/gemini-4-neon'
                              : 'fixture-default',
                        options: [fixtureModelOption]
                      }
                    ])
    })
  } else if (method === '_x.ai/models/list') {
    if (scenario !== 'grok-model-catalog') return emit({ id, error: { code: -32601, message: 'Method not found' } })
    reply(id, {
      result: {
        currentModelId: 'grok-reasoning',
        availableModels: [
          {
            modelId: 'grok-reasoning',
            name: 'Grok Reasoning',
            description: 'Grok model description',
            _meta: { reasoningEfforts: [{ value: 'high', label: 'High', default: true }], fixture: { fast: true } }
          },
          { modelId: 'grok-basic', name: 'Grok Basic' },
          { modelId: 'internal', hidden: true }
        ]
      }
    })
  } else if (method === 'session/close') {
    if (scenario === 'close-hang') return
    if (scenario === 'close-error') return emit({ id, error: { code: -32603, message: 'Close failed' } })
    reply(id, {})
  } else if (method === 'session/set_mode') {
    modeValue = message.params.modeId
    if (scenario === 'mode-legacy-upgrade')
      update({ sessionUpdate: 'config_option_update', configOptions: [thought()] })
    if (scenario === 'mode-legacy-upgrade-with-mode')
      update({
        sessionUpdate: 'config_option_update',
        configOptions: [{ ...mode(), id: 'legacy-mode', currentValue: 'ask' }]
      })
    update({ sessionUpdate: 'current_mode_update', currentModeId: modeValue })
    reply(id, {})
  } else if (scenario === 'grok-prediction' && method === '_x.ai/suggestPrompt') {
    const { sessionId, generation } = message.params
    return reply(id, {
      generation: generation === 1 ? generation : generation - 1,
      suggestion: sessionId === 'native-session' ? 'run the tests' : null
    })
  } else if (scenario === 'grok-legacy-effort' && method === 'session/set_model') {
    const { modelId, _meta } = message.params
    if (_meta?.reasoningEffort && (modelId !== 'grok-reasoning' || _meta.reasoningEffort !== 'xhigh'))
      return emit({ id, error: { code: -32602, message: 'Unsupported model effort' } })
    reply(id, {})
  } else if (method === 'session/set_config_option') {
    if (nativePermissionOptions[scenario]) {
      if (
        scenario === 'cline-native-permissions' &&
        message.params.configId === 'auto_approve' &&
        (message.params.type !== 'boolean' || typeof message.params.value !== 'boolean')
      )
        return emit({ id, error: { code: -32602, message: 'Native approval requires a boolean' } })
      if (scenario === 'junie-native-permissions' && message.params.value === 'on') {
        update({ sessionUpdate: 'config_option_update', configOptions: junieModes() })
      }
      secondaryValues[message.params.configId] = message.params.value
      return reply(id, { configOptions: nativePermissionOptions[scenario]() })
    }
    if (scenario === 'model-setup-update') {
      update({ sessionUpdate: 'config_option_update', configOptions: [thought()] })
      update({ sessionUpdate: 'compaction_update', compactionId: 'replayed', status: 'in_progress' })
    }
    if (scenario === 'config-semantics') return reply(id, { configOptions: [extraConfig()[1], mode()] })
    if (scenario === 'config-multiple') {
      secondaryValues[message.params.configId] = message.params.value
      return reply(id, { configOptions: multipleConfig() })
    }
    if (scenario.startsWith('config')) {
      if (scenario === 'config-error') return emit({ id, error: { code: -32602, message: 'Configuration rejected' } })
      if (message.params.configId === 'verbosity') verbosity = message.params.value
      if (message.params.configId === 'notifications') {
        if (message.params.type !== 'boolean')
          return emit({ id, error: { code: -32602, message: 'Boolean discriminator required' } })
        notifications = message.params.value
      }
      return reply(id, { configOptions: extraConfig() })
    }

    if (message.params.configId === 'agent-mode') {
      if (scenario === 'mode-error') return emit({ id, error: { code: -32602, message: 'Mode unavailable' } })
      modeValue = message.params.value
      return reply(id, { configOptions: scenario === 'mode-removed' ? [] : [mode()] })
    }
    if (message.params.configId === thought().id) {
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
          options: [fixtureModelOption]
        }
      ]
    })
  } else if (method === 'model/list') {
    const efforts = [
      { reasoningEffort: 'low', description: 'Fast' },
      { reasoningEffort: 'medium', description: 'Balanced' },
      { reasoningEffort: 'high', description: 'Deep' },
      { reasoningEffort: 'xhigh', description: 'Extra' },
      { reasoningEffort: 'ultra', description: 'Deepest' }
    ]
    reply(id, {
      data: [
        {
          id: 'fixture-model',
          displayName: 'Fixture model',
          ...(scenario !== 'codex-no-effort' && { supportedReasoningEfforts: efforts })
        },
        ...(scenario.startsWith('codex-usage')
          ? [{ id: 'gpt-5-codex', displayName: 'GPT-5 Codex', supportedReasoningEfforts: efforts }]
          : [])
      ],
      nextCursor: null
    })
  } else if (method === 'config/read') {
    reply(id, { config: { mcp_servers: { fixture: { enabled: true } } } })
  } else if (method === 'thread/start' || method === 'thread/resume') {
    if (
      method === 'thread/resume' &&
      (scenario === 'no-rollout' || (scenario === 'lost-rollout' && message.params.threadId === 'lost-thread'))
    ) {
      return emit({ id, error: { code: -32600, message: `no rollout found for thread id ${message.params.threadId}` } })
    }
    cwd = message.params.cwd
    const threadMode =
      message.params.sandbox === 'read-only' && scenario !== 'codex-ignores-readonly'
        ? { approvalPolicy: 'never', sandbox: { type: 'readOnly', networkAccess: false } }
        : scenario.startsWith('codex-full-access')
          ? { approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } }
          : scenario === 'codex-readonly'
            ? { approvalPolicy: 'on-request', sandbox: { type: 'readOnly', networkAccess: false } }
            : {}
    reply(id, { thread: { id: 'native-session' }, model: message.params.model ?? 'fixture-model', ...threadMode })
  } else if (method === 'thread/name/set' || method === 'thread/fork') {
    if (scenario === 'no-rollout' && turn === 0) {
      return emit({ id, error: { code: -32600, message: `no rollout found for thread id ${message.params.threadId}` } })
    }
    reply(id, method === 'thread/fork' ? { thread: { id: 'forked-session' } } : {})
  } else if (method === 'thread/compact/start') {
    if (scenario === 'no-rollout' && turn === 0) {
      return emit({ id, error: { code: -32600, message: `no rollout found for thread id ${message.params.threadId}` } })
    }
    promptId = id
    turn++
    reply(id, {})
    emit({ method: 'turn/started', params: { threadId: 'native-session', turn: { id: 'compact-turn' } } })
    emit({
      method: 'item/started',
      params: {
        threadId: 'native-session',
        turnId: 'compact-turn',
        item: { id: 'compact-item', type: 'contextCompaction' }
      }
    })
    emit({
      method: 'item/completed',
      params: {
        threadId: 'native-session',
        turnId: 'compact-turn',
        item: { id: 'compact-item', type: 'contextCompaction' }
      }
    })
    finish('compact-turn')
  } else if (method === 'skills/list') {
    reply(id, {
      data: [
        {
          cwd: cwd ?? '/tmp',
          skills: [
            { name: 'repo-skill', description: 'Repository skill from Codex', path: '/tmp/SKILL.md', enabled: true }
          ]
        }
      ]
    })
  } else if (method === 'account/usage/read') {
    reply(id, { summary: { totalTokens: 500 } })
  } else if (method === 'thread/revert') {
    reply(id, { thread: { id: 'native-session', turns: [] } })
  } else if (method === 'review/start') {
    promptId = id
    turn++
    reply(id, { turn: { id: 'turn' }, reviewThreadId: message.params.threadId })
    emit({ method: 'turn/started', params: { threadId: 'native-session', turn: { id: 'turn' } } })
    text(`review: ${JSON.stringify(message.params.target)}`)
    finish()
  } else if (method === 'session/prompt' || method === 'turn/start') {
    if (thoughtPending)
      return emit({ id, error: { code: -32603, message: 'Prompt arrived before configuration settled' } })
    promptId = id
    turn++
    if (scenario === 'workspace') {
      if (protocol === 'codex') {
        reply(id, { turn: { id: 'turn' } })
        emit({ method: 'turn/started', params: { threadId: 'native-session', turn: { id: 'turn' } } })
      }
      text(process.cwd())
      finish()
      return
    }
    if (scenario.startsWith('pi-startup')) {
      if (scenario !== 'pi-startup-early') text(piBanner)
      text('OK')
      text(piBanner)
      finish()
      return
    }
    if (scenario === 'error-details')
      return emit({
        id,
        error: {
          code: -32603,
          message: 'Internal error',
          data: { details: 'No model selected; API_KEY=private-fixture-secret' }
        }
      })
    if (scenario.startsWith('request-cancel:')) {
      void (async () => {
        const kind = scenario.split(':')[1]
        const sessionId = 'native-session'
        let response
        if (kind === 'wait') {
          const created = await requestClient('terminal/create', {
            sessionId,
            command: process.execPath,
            args: ['-e', 'setTimeout(() => {}, 60000)']
          })
          const terminalId = created.result.terminalId
          const waiting = requestClient('terminal/wait_for_exit', { sessionId, terminalId })
          setTimeout(() => emit({ method: '$/cancel_request', params: { requestId: 'callback-2' } }), 50)
          response = await waiting
          await requestClient('terminal/kill', { sessionId, terminalId })
          await requestClient('terminal/release', { sessionId, terminalId })
        } else {
          const requests = {
            permission: [
              'session/request_permission',
              {
                sessionId,
                toolCall: { toolCallId: 'cancelled-tool', title: 'Cancelled operation' },
                options: [
                  { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
                  { optionId: 'deny', name: 'Deny', kind: 'reject_once' }
                ]
              }
            ],
            form: [
              'elicitation/create',
              {
                sessionId,
                mode: 'form',
                message: 'Enter a value',
                requestedSchema: { type: 'object', properties: { value: { type: 'string' } } }
              }
            ],
            write: ['fs/write_text_file', { sessionId, path: `${cwd}/cancelled.txt`, content: 'must not be written' }],
            terminal: [
              'terminal/create',
              {
                sessionId,
                command: process.execPath,
                args: [
                  '-e',
                  `require('node:fs').writeFileSync(${JSON.stringify(`${cwd}/cancelled.txt`)}, 'must not run')`
                ]
              }
            ]
          }
          const pending = requestClient(...requests[kind])
          setTimeout(() => emit({ method: '$/cancel_request', params: { requestId: 'callback-1' } }), 50)
          response = await pending
        }
        text(JSON.stringify(response.error ?? response.result))
        finish()
      })()
      return
    }
    if (scenario.startsWith('terminal-') || scenario === 'callback-boundaries') {
      void (async () => {
        const script =
          scenario === 'terminal-split'
            ? 'const a=Buffer.from("你好🌸"),b=Buffer.from("界");process.stdout.write(a.subarray(0,2));process.stderr.write(b.subarray(0,1));setTimeout(()=>{process.stdout.end(a.subarray(2));setTimeout(()=>process.stderr.end(b.subarray(1)),30)},30)'
            : scenario === 'terminal-signal'
              ? 'process.kill(process.pid,"SIGTERM")'
              : scenario.startsWith('terminal-limit:')
                ? 'process.stdout.write("prefix你好🌸!")'
                : 'process.stdout.write("prefix你好🌸")'
        const created = await requestClient('terminal/create', {
          sessionId: 'native-session',
          command:
            scenario === 'terminal-command'
              ? 'echo command result'
              : scenario === 'terminal-missing'
                ? 'missing-fixture-executable'
                : scenario === 'terminal-path'
                  ? join(cwd, `node with spaces${extname(process.execPath)}`)
                  : process.execPath,
          ...(scenario === 'terminal-command' || scenario === 'terminal-missing'
            ? {}
            : {
                args: [
                  '-e',
                  scenario === 'terminal-literal' ? 'process.stdout.write(process.argv[1])' : script,
                  ...(scenario === 'terminal-literal' ? ['literal ; echo injected'] : [])
                ]
              }),
          outputByteLimit: scenario.startsWith('terminal-limit:') ? Number(scenario.split(':')[1]) : 1024
        })
        const terminalId = created.result.terminalId
        if (scenario === 'callback-boundaries') {
          const foreign = { sessionId: 'foreign-session' }
          const results = await Promise.all([
            requestClient('fs/read_text_file', { ...foreign, path: `${cwd}/marker.txt` }),
            requestClient('fs/write_text_file', { ...foreign, path: `${cwd}/foreign.txt`, content: 'wrong session' }),
            requestClient('terminal/create', {
              ...foreign,
              command: process.execPath,
              args: ['-e', 'process.exit(0)']
            }),
            ...['output', 'wait_for_exit', 'kill', 'release'].map((method) =>
              requestClient(`terminal/${method}`, { ...foreign, terminalId })
            )
          ])
          text(JSON.stringify(results.map((response) => response.error ?? response.result)))
        }
        await requestClient('terminal/wait_for_exit', { sessionId: 'native-session', terminalId })
        if (scenario === 'terminal-idle') finish()
        const output = await requestClient('terminal/output', { sessionId: 'native-session', terminalId })
        if (scenario !== 'callback-boundaries') text(JSON.stringify(output.result))
        await requestClient('terminal/release', { sessionId: 'native-session', terminalId })
        if (scenario === 'terminal-idle')
          await requestClient('terminal/output', { sessionId: 'native-session', terminalId })
        if (scenario !== 'terminal-idle') finish()
      })().catch((error) => emit({ id: promptId, error: { code: -32603, message: String(error) } }))
      return
    }
    if (protocol === 'codex') {
      reply(id, { turn: { id: 'turn', status: 'inProgress' } })
      emit({ method: 'turn/started', params: { threadId: 'native-session', turn: { id: 'turn' } } })
    }
    if (scenario === 'codex-text-items') {
      const frame = (method, payload) =>
        emit({ method, params: { threadId: 'native-session', turnId: 'turn', ...payload } })
      frame('item/started', { item: { type: 'agentMessage', id: 'a', phase: 'commentary', text: '' } })
      frame('item/agentMessage/delta', { itemId: 'a', delta: 'Working.' })
      frame('item/completed', { item: { type: 'agentMessage', id: 'a', phase: 'commentary', text: 'Working.' } })
      frame('item/completed', { item: { type: 'agentMessage', id: 'b', phase: 'final_answer', text: 'Finished.' } })
      finish()
      return
    }
    if (scenario === 'acp-policy-yolo' || scenario === 'acp-policy-plan') {
      void (async () => {
        const perm = await requestClient('session/request_permission', {
          sessionId: 'native-session',
          toolCall: { toolCallId: 'yolo-perm', kind: 'execute', title: 'Run check' },
          options: [
            { optionId: 'always', name: 'Always', kind: 'allow_always' },
            { optionId: 'once', name: 'Once', kind: 'allow_once' },
            { optionId: 'deny', name: 'Deny', kind: 'reject_once' }
          ]
        })
        const writeRes = await requestClient('fs/write_text_file', {
          sessionId: 'native-session',
          path: `${cwd}/yolo.txt`,
          content: 'yolo ok'
        })
        const created = await requestClient('terminal/create', {
          sessionId: 'native-session',
          command: process.execPath,
          args: ['-e', 'process.stdout.write("term-ok")']
        })
        if (created.error) {
          text(JSON.stringify({ perm: perm.result, wrote: !writeRes.error, terminalDenied: true }))
          finish()
          return
        }
        const termId = created.result.terminalId
        await requestClient('terminal/wait_for_exit', { sessionId: 'native-session', terminalId: termId })
        const out = await requestClient('terminal/output', { sessionId: 'native-session', terminalId: termId })
        await requestClient('terminal/release', { sessionId: 'native-session', terminalId: termId })
        text(JSON.stringify({ perm: perm.result, wrote: !writeRes.error, term: out.result.output }))
        finish()
      })().catch((error) => emit({ id: promptId, error: { code: -32603, message: String(error) } }))
      return
    }
    if (scenario === 'acp-policy-auto') {
      void (async () => {
        const perm = await requestClient('session/request_permission', {
          sessionId: 'native-session',
          toolCall: { toolCallId: 'auto-edit', kind: 'edit', locations: [{ path: `${cwd}/auto.txt` }] },
          options: [
            { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'deny', name: 'Deny', kind: 'reject_once' }
          ]
        })
        text(JSON.stringify(perm.result))
        finish()
      })().catch((error) => emit({ id: promptId, error: { code: -32603, message: String(error) } }))
      return
    }
    if (scenario === 'acp-policy-session-grants') {
      void (async () => {
        if (turn === 1) {
          await requestClient('session/request_permission', {
            sessionId: 'native-session',
            toolCall: { toolCallId: 'exec-1', kind: 'execute', title: 'Run build' },
            options: [
              { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
              { optionId: 'always', name: 'Allow always', kind: 'allow_always' },
              { optionId: 'deny', name: 'Deny', kind: 'reject_once' }
            ]
          })
          const created = await requestClient('terminal/create', {
            sessionId: 'native-session',
            command: process.execPath,
            args: ['-e', 'process.stdout.write("turn1-term")']
          })
          const termId = created.result.terminalId
          await requestClient('terminal/wait_for_exit', { sessionId: 'native-session', terminalId: termId })
          await requestClient('terminal/release', { sessionId: 'native-session', terminalId: termId })
          text('turn1-done')
        } else if (turn === 2) {
          const created = await requestClient('terminal/create', {
            sessionId: 'native-session',
            command: process.execPath,
            args: ['-e', 'process.stdout.write("turn2-term")']
          })
          const termId = created.result.terminalId
          await requestClient('terminal/wait_for_exit', { sessionId: 'native-session', terminalId: termId })
          await requestClient('terminal/release', { sessionId: 'native-session', terminalId: termId })
          await requestClient('session/request_permission', {
            sessionId: 'native-session',
            toolCall: { toolCallId: 'edit-1', kind: 'edit', locations: [{ path: `${cwd}/in.txt` }] },
            options: [
              { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
              { optionId: 'always', name: 'Allow always', kind: 'allow_always' },
              { optionId: 'deny', name: 'Deny', kind: 'reject_once' }
            ]
          })
          await requestClient('fs/write_text_file', {
            sessionId: 'native-session',
            path: `${cwd}/in2.txt`,
            content: 'inside-ok'
          })
          const outside = await requestClient('fs/write_text_file', {
            sessionId: 'native-session',
            path: `${cwd}/../escape.txt`,
            content: 'outside'
          })
          text(JSON.stringify({ outsideRejected: Boolean(outside.error) }))
        } else {
          await requestClient('session/request_permission', {
            sessionId: 'native-session',
            toolCall: { toolCallId: 'exec-3', kind: 'execute', title: 'Run test' },
            options: [
              { optionId: 'always', name: 'Allow always', kind: 'allow_always' },
              { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
              { optionId: 'deny', name: 'Deny', kind: 'reject_once' }
            ]
          })
          const created = await requestClient('terminal/create', {
            sessionId: 'native-session',
            command: process.execPath,
            args: ['-e', 'process.stdout.write("turn3-term")']
          })
          const termId = created.result.terminalId
          await requestClient('terminal/wait_for_exit', { sessionId: 'native-session', terminalId: termId })
          await requestClient('terminal/release', { sessionId: 'native-session', terminalId: termId })
          text('turn3-done')
        }
        finish()
      })().catch((error) => emit({ id: promptId, error: { code: -32603, message: String(error) } }))
      return
    }
    if (scenario === 'acp-policy-allow-once-only') {
      void (async () => {
        const w1 = await requestClient('session/request_permission', {
          sessionId: 'native-session',
          toolCall: { toolCallId: 'w1', kind: 'edit', rawInput: { Path: `${cwd}/one.html` } },
          options: [
            { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
            { optionId: 'deny', name: 'Deny', kind: 'reject_once' }
          ]
        })
        const w2 = await requestClient('session/request_permission', {
          sessionId: 'native-session',
          toolCall: { toolCallId: 'w2', kind: 'edit', rawInput: { Path: `${cwd}/two.html` } },
          options: [
            { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
            { optionId: 'deny', name: 'Deny', kind: 'reject_once' }
          ]
        })
        const e1 = await requestClient('session/request_permission', {
          sessionId: 'native-session',
          toolCall: { toolCallId: 'e1', kind: 'execute', title: 'echo one' },
          options: [
            { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
            { optionId: 'deny', name: 'Deny', kind: 'reject_once' }
          ]
        })
        const e2 = await requestClient('session/request_permission', {
          sessionId: 'native-session',
          toolCall: { toolCallId: 'e2', kind: 'execute', title: 'echo two' },
          options: [
            { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
            { optionId: 'deny', name: 'Deny', kind: 'reject_once' }
          ]
        })
        text(JSON.stringify([w1.result, w2.result, e1.result, e2.result]))
        finish()
      })().catch((error) => emit({ id: promptId, error: { code: -32603, message: String(error) } }))
      return
    }
    if (scenario === 'acp-antigravity-warning-grant') {
      void (async () => {
        const p1 = await requestClient('session/request_permission', {
          sessionId: 'native-session',
          toolCall: { toolCallId: 'cmd1', kind: 'execute', title: 'echo one' },
          options: [
            { optionId: 'once', name: 'Allow', kind: 'allow_once' },
            {
              optionId: 'always-native',
              name: 'Always Allow',
              kind: 'allow_always',
              _meta: { 'agy.security.warning': { message: 'Allows shell commands for this thread.' } }
            },
            { optionId: 'deny', name: 'Deny', kind: 'reject_once' }
          ]
        })
        const p2 = await requestClient('session/request_permission', {
          sessionId: 'native-session',
          toolCall: { toolCallId: 'cmd2', kind: 'execute', title: 'echo two' },
          options: [
            { optionId: 'once', name: 'Allow', kind: 'allow_once' },
            { optionId: 'always-native', name: 'Always Allow', kind: 'allow_always' },
            { optionId: 'deny', name: 'Deny', kind: 'reject_once' }
          ]
        })
        text(JSON.stringify([p1.result, p2.result]))
        finish()
      })().catch((error) => emit({ id: promptId, error: { code: -32603, message: String(error) } }))
      return
    }
    if (scenario === 'acp-usage-zero-size') {
      update({ sessionUpdate: 'usage_update', used: 5000, size: 0 })
      text('zero-size-ok')
      finish()
      return
    }
    if (scenario === 'acp-antigravity-interaction') {
      void (async () => {
        const perm = await requestClient('session/request_permission', {
          sessionId: 'native-session',
          toolCall: {
            toolCallId: 'interaction_1',
            title: 'Select environment',
            rawInput: { prompt: 'Deploy target?' }
          },
          options: [
            { optionId: 'opt-staging', name: 'Staging', kind: 'allow_once' },
            { optionId: 'opt-prod', name: 'Production', kind: 'allow_once' }
          ]
        })
        text(JSON.stringify(perm.result))
        finish()
      })().catch((error) => emit({ id: promptId, error: { code: -32603, message: String(error) } }))
      return
    }
    if (scenario === 'acp-browser-permission') {
      void (async () => {
        const perm = await requestClient('session/request_permission', {
          sessionId: 'native-session',
          toolCall: { toolCallId: 'auto-1', title: 'mcp__automation__js', kind: 'other', status: 'pending' },
          options: [
            { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
            { optionId: 'deny', name: 'Deny', kind: 'reject_once' }
          ]
        })
        text(JSON.stringify(perm.result))
        finish()
      })().catch((error) => emit({ id: promptId, error: { code: -32603, message: String(error) } }))
      return
    }
    if (scenario === 'acp-copilot-browser-permission') {
      void (async () => {
        emit({
          method: 'session/update',
          params: {
            sessionId: 'native-session',
            update: {
              sessionUpdate: 'tool_call',
              toolCallId: 'auto-copilot-1',
              title: 'automation-js',
              kind: 'other',
              status: 'pending'
            }
          }
        })
        const perm = await requestClient('session/request_permission', {
          sessionId: 'native-session',
          toolCall: { toolCallId: 'auto-copilot-1', title: 'js', kind: 'other', status: 'pending' },
          options: [
            { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'deny', name: 'Deny', kind: 'reject_once' }
          ]
        })
        text(JSON.stringify(perm.result))
        finish()
      })().catch((error) => emit({ id: promptId, error: { code: -32603, message: String(error) } }))
      return
    }
    if (scenario === 'codex-browser-mcp') {
      emit({
        method: 'item/started',
        params: {
          threadId: 'native-session',
          turnId: 'turn',
          item: {
            id: 'mcp-1',
            type: 'mcpToolCall',
            server: 'automation',
            tool: 'js',
            arguments: { title: 'Inspect tab', code: 'await browser.getTab()' }
          }
        }
      })
      emit({
        method: 'item/completed',
        params: {
          threadId: 'native-session',
          turnId: 'turn',
          item: {
            id: 'mcp-1',
            type: 'mcpToolCall',
            server: 'automation',
            tool: 'js',
            status: 'completed',
            arguments: { title: 'Inspect tab', code: 'await browser.getTab()' },
            result: {
              content: [
                { type: 'text', text: 'Tab ready' },
                { type: 'text', text: 'REPL_CONTEXT {"cell":"12345678-1234-4234-8234-123456789abc"}' }
              ]
            }
          }
        }
      })
      text(process.env.CHERRY_BROWSER_MCP_TOKEN ?? 'missing')
      finish()
      return
    }
    if (scenario === 'codex-full-access-approvals') {
      void (async () => {
        const cmd = await requestClient('item/commandExecution/requestApproval', {
          threadId: 'native-session',
          turnId: 'turn',
          itemId: 'cmd-1',
          command: 'echo hi'
        })
        const fc = await requestClient('item/fileChange/requestApproval', {
          threadId: 'native-session',
          turnId: 'turn',
          itemId: 'fc-1'
        })
        const perms = await requestClient('item/permissions/requestApproval', {
          threadId: 'native-session',
          turnId: 'turn',
          itemId: 'perm-1',
          permissions: { fileSystem: { write: [cwd] } }
        })
        text(JSON.stringify({ cmd: cmd.result, fc: fc.result, perms: perms.result }))
        finish()
      })().catch((error) => emit({ id: promptId, error: { code: -32603, message: String(error) } }))
      return
    }
    if (scenario === 'codex-interactive-approvals') {
      void (async () => {
        const cmd = await requestClient('item/commandExecution/requestApproval', {
          threadId: 'native-session',
          turnId: 'turn',
          itemId: 'cmd-1',
          command: 'git status',
          availableDecisions: [
            'accept',
            'acceptForSession',
            { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['git', 'status'] } },
            { applyNetworkPolicyAmendment: { network_policy_amendment: { host: 'example.com', action: 'allow' } } },
            { applyNetworkPolicyAmendment: { network_policy_amendment: { host: 'evil.test', action: 'deny' } } },
            'decline',
            'cancel'
          ]
        })
        const p1 = await requestClient('item/permissions/requestApproval', {
          threadId: 'native-session',
          turnId: 'turn',
          itemId: 'perm-1',
          permissions: { fileSystem: { write: [cwd] } }
        })
        const p2 = await requestClient('item/permissions/requestApproval', {
          threadId: 'native-session',
          turnId: 'turn',
          itemId: 'perm-2',
          permissions: { network: { allowedHosts: ['example.com'] } }
        })
        text(JSON.stringify({ cmd: cmd.result, p1: p1.result, p2: p2.result }))
        finish()
      })().catch((error) => emit({ id: promptId, error: { code: -32603, message: String(error) } }))
      return
    }
    if (scenario === 'codex-item-permissions') {
      void (async () => {
        const first = await requestClient('item/permissions/requestApproval', {
          threadId: 'native-session',
          turnId: 'turn',
          itemId: 'perm-1',
          permissions: { fileSystem: { write: [cwd] } }
        })
        const second = await requestClient('item/permissions/requestApproval', {
          threadId: 'native-session',
          turnId: 'turn',
          itemId: 'perm-2',
          permissions: { network: { allowedHosts: ['example.com'] } }
        })
        text(JSON.stringify([first.result, second.result]))
        finish()
      })().catch((error) => emit({ id: promptId, error: { code: -32603, message: String(error) } }))
      return
    }
    if (protocol === 'codex' && scenario.startsWith('codex-usage')) {
      const counts = (input, output) => ({
        inputTokens: input,
        outputTokens: output,
        totalTokens: input + output,
        cachedInputTokens: input / 2,
        reasoningOutputTokens: output / 2
      })
      const notify = (total, last, overrides = {}, modelContextWindow) =>
        emit({
          method: 'thread/tokenUsage/updated',
          params: {
            threadId: 'native-session',
            turnId: 'turn',
            tokenUsage: { total, last, ...(modelContextWindow !== undefined ? { modelContextWindow } : {}) },
            ...overrides
          }
        })
      if (scenario === 'codex-usage-invalid') {
        notify(counts(-10, 2), counts(-10, 2))
      } else if (scenario === 'codex-usage-native-window') {
        notify(counts(1100, 110), counts(250, 20), {}, 258_400)
      } else {
        notify(counts(9000, 900), counts(9000, 900), { threadId: 'other' })
        notify(counts(9000, 900), counts(9000, 900), { turnId: 'previous-turn' })
        if (turn === 1) {
          notify(counts(1100, 110), counts(100, 10))
          notify(counts(1100, 110), counts(100, 10))
          notify(counts(1300, 130), counts(200, 20))
        } else {
          notify(counts(1340, 134), counts(40, 4))
        }
      }
      text('hello')
      finish()
      notify(counts(9990, 990), counts(9990, 990))
      return
    }
    if (scenario.startsWith('compaction')) {
      const compact = (compactionId, status, extra = {}) =>
        update({ sessionUpdate: 'compaction_update', compactionId, status, ...extra })
      compact('first', 'in_progress')
      compact('first', 'in_progress')
      if (scenario === 'compaction-overlap') {
        compact('second', 'in_progress')
        compact('first', 'completed')
        compact('first', 'in_progress')
        emit({
          method: 'session/update',
          params: {
            sessionId: 'unrelated',
            update: { sessionUpdate: 'compaction_update', compactionId: 'second', status: 'completed' }
          }
        })
        text('Still compacting')
        return
      }
      if (scenario === 'compaction-crash') return setTimeout(() => process.exit(1), 25)
      if (scenario === 'compaction-cancel') return
      if (scenario === 'compaction-failed') compact('first', 'failed', { error: 'Summary failed' })
      if (scenario === 'compaction-completed') compact('first', 'completed')
    }
    if (scenario === 'session-cost') {
      for (const cost of [
        { amount: 0.4, currency: 'EUR' },
        { amount: 0.25, currency: 'EUR' },
        { amount: 0, currency: 'CNY' },
        { amount: -1, currency: 'USD' },
        { amount: 10, currency: 'invalid' },
        null,
        undefined
      ])
        update({ sessionUpdate: 'usage_update', used: 0, size: 0, cost })
      emit({
        method: 'session/update',
        params: {
          sessionId: 'unrelated',
          update: { sessionUpdate: 'usage_update', used: 10, size: 100, cost: { amount: 999, currency: 'USD' } }
        }
      })
    }
    if (scenario === 'context-usage') {
      update({
        sessionUpdate: 'usage_update',
        used: turn === 1 ? 40 : 10,
        size: 100,
        cost: { amount: 1, currency: 'USD' }
      })
      update({ sessionUpdate: 'usage_update', used: 10, size: 0 })
      update({ sessionUpdate: 'usage_update', used: -1, size: 100 })
      emit({
        method: 'session/update',
        params: {
          sessionId: 'unrelated',
          update: { sessionUpdate: 'usage_update', used: 99, size: 100 }
        }
      })
    }
    if (scenario.startsWith('grok-question') || scenario === 'grok-plan') {
      const target = {
        sessionId: scenario === 'grok-question-foreign' ? 'other-session' : message.params.sessionId,
        toolCallId: 'grok-interaction'
      }
      const pending =
        scenario === 'grok-plan'
          ? requestClient('x.ai/exit_plan_mode', { ...target, planContent: '# Release plan' })
          : requestClient('_x.ai/ask_user_question', {
              ...target,
              mode: scenario === 'grok-question-plan' ? 'plan' : 'default',
              questions: [
                { question: 'Which?', options: [{ label: 'A, B' }, { label: 'C' }], multiSelect: true },
                { question: 'Why?', options: [] },
                { question: 'Preview?', options: [{ label: 'Show', preview: 'Diagram' }] }
              ]
            })
      if (scenario === 'grok-question-cancel')
        setTimeout(() => emit({ method: '$/cancel_request', params: { requestId: 'callback-1' } }), 50)
      void pending.then(() => {
        update({ sessionUpdate: 'tool_call_update', toolCallId: target.toolCallId, status: 'completed' })
        finish()
      })
      return
    }
    if (scenario.startsWith('xai-usage')) {
      const { sessionId, _meta } = message.params
      const nativePromptId = _meta?.promptId
      const ledger = {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        cachedReadTokens: 40,
        cacheCreationTokens: 10,
        reasoningTokens: 5
      }
      const foreign = { inputTokens: 999, outputTokens: 1, totalTokens: 1000 }
      const completed = (sessionId, identity, usage, meta, method = '_x.ai/session_notification') =>
        emit({
          method,
          params: { sessionId, _meta: meta, update: { sessionUpdate: 'turn_completed', ...identity, usage } }
        })

      if (turn === 1) {
        if (scenario === 'xai-usage-legacy')
          completed(sessionId, { promptId: nativePromptId }, ledger, undefined, '_x.ai/session/update')
        else completed(sessionId, { prompt_id: nativePromptId }, ledger)
      }
      if (previousGrokPromptId) completed(sessionId, { promptId: previousGrokPromptId }, foreign)
      previousGrokPromptId = nativePromptId
      completed('unrelated', { promptId: nativePromptId }, foreign)
      completed(sessionId, { promptId: 'task-completed-background' }, foreign, undefined, '_x.ai/session/update')
      completed(sessionId, {}, foreign)
      completed(sessionId, { promptId: nativePromptId }, foreign, { isReplay: true })

      if (scenario === 'xai-usage-response') {
        const meta = { promptId: nativePromptId, usage: { inputTokens: 7, outputTokens: 2 } }
        return reply(id, {
          stopReason: 'end_turn',
          _meta: meta,
          ...(turn === 2 && { usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } })
        })
      }
      if (scenario === 'xai-usage-reassigned')
        return reply(id, { stopReason: 'end_turn', _meta: { promptId: 'different-prompt' } })
      return reply(id, { stopReason: 'end_turn' })
    }
    if (scenario === 'config-extra') update({ sessionUpdate: 'config_option_update', configOptions: [] })
    if (scenario === 'session-title') {
      update({ sessionUpdate: 'session_info_update', title: 'Native updated title' })
      update({ sessionUpdate: 'session_info_update', title: null })
      update({ sessionUpdate: 'session_info_update', updatedAt: '2026-09-30T00:00:00Z' })
    }
    if (scenario === 'message-ids') {
      const content = (sessionUpdate, messageId, value) => update({ sessionUpdate, messageId, content: value })
      const chunk = (messageId, text) => content('agent_message_chunk', messageId, { type: 'text', text })
      content('agent_thought_chunk', 'thought', { type: 'text', text: 'Think' })
      content('agent_thought_chunk', 'thought', { type: 'text', text: ' carefully' })
      chunk('native:id/中文 1', 'First')
      update({ sessionUpdate: 'usage_update', used: 10, size: 100 })
      chunk('native:id/中文 1', ' message')
      chunk('second', 'Second message')
      chunk('third', '')
      chunk('third', 'Third message')
      update({ sessionUpdate: 'tool_call', toolCallId: 'read', title: 'Read', status: 'completed' })
      chunk('third', 'After tool')
      content('agent_message_chunk', 'third', { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' })
      content('agent_thought_chunk', 'thought-image', { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' })
      chunk(undefined, 'Legacy')
      chunk(null, ' response')
      chunk('third', 'Tagged again')
      chunk(undefined, 'Final without ID')
      content('agent_message_chunk', undefined, { type: 'resource_link', uri: 'file:///example.txt', name: 'Result' })
      finish()
      return
    }
    text(`turn ${turn}: `)
    if (scenario === 'rich-cancel' || scenario === 'close-active') {
      update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Still thinking' } })
      return
    }
    if (scenario === 'rich-content') {
      const contents = [
        { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' },
        { type: 'audio', mimeType: 'audio/wav', data: 'YXVkaW8=' },
        { type: 'resource_link', uri: 'https://example.com/report', name: 'report', description: 'Result report' },
        { type: 'resource', resource: { uri: 'file:///example.txt', mimeType: 'text/plain', text: 'Embedded result' } },
        { type: 'resource', resource: { uri: 'file:///example.bin', blob: 'YmluYXJ5' } }
      ]
      for (const content of contents) update({ sessionUpdate: 'agent_message_chunk', content })
      update({ sessionUpdate: 'agent_thought_chunk', content: contents[0] })
      update({
        sessionUpdate: 'tool_call',
        toolCallId: 'output',
        title: 'Read outputs',
        status: 'in_progress',
        content: contents.map((content) => ({ type: 'content', content }))
      })
      update({ sessionUpdate: 'tool_call_update', toolCallId: 'output', status: 'failed', rawOutput: 'Read failed' })
      text('Done')
      finish()
      return
    }
    if (scenario === 'rich-output') {
      update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Inspect first' } })
      update({ sessionUpdate: 'plan', entries: [{ content: 'Inspect', priority: 'high', status: 'in_progress' }] })
      update({
        sessionUpdate: 'tool_call',
        toolCallId: 'edit',
        title: 'Edit example',
        name: 'edit_file',
        kind: 'edit',
        status: 'pending',
        rawInput: { path: '/example' }
      })
      update({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'edit',
        status: 'in_progress',
        name: null,
        locations: [
          { path: '/example', line: 2 },
          { path: '/example', line: null }
        ],
        content: [{ type: 'diff', path: '/example', oldText: 'old', newText: 'new' }]
      })
      update({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'edit',
        name: 'apply_edit',
        status: 'completed',
        rawInput: null
      })
      update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Then answer' } })
      update({ sessionUpdate: 'plan', entries: [{ content: 'Inspect', priority: 'high', status: 'completed' }] })
      text('Done')
      finish()
      return
    }
    if (scenario === 'crash') process.exit(7)
    if (scenario === 'cancel') return
    if (scenario.startsWith('elicitation')) {
      emit({
        id: 'elicitation',
        method: 'elicitation/create',
        params: {
          mode: scenario === 'elicitation-url' ? 'url' : 'form',
          sessionId: scenario === 'elicitation-foreign' ? 'another-session' : 'native-session',
          message: 'Configure the task',
          requestedSchema: {
            type: 'object',
            properties: {
              count: { type: 'integer', minimum: 1, maximum: 5 },
              enabled: { type: 'boolean', default: false }
            },
            required: ['count', 'enabled']
          }
        }
      })
      return
    }
    if (scenario === 'missing-tool-result') {
      update({ sessionUpdate: 'tool_call', toolCallId: 'incomplete', title: 'Read file', status: 'in_progress' })
      finish()
      return
    }
    if (scenario === 'approved-write-later-turn' && turn > 1) {
      emit({
        id: 'approved-write',
        method: 'fs/write_text_file',
        params: {
          sessionId: 'native-session',
          path: `${cwd}/approved.txt`,
          content: 'approved content'
        }
      })
      return
    }
    if (scenario.startsWith('approved-write')) {
      const content = [{ type: 'diff', path: `${cwd}/approved.txt`, newText: 'approved content' }]
      update({
        sessionUpdate: 'tool_call',
        toolCallId: 'write',
        title: 'Write file',
        kind: 'edit',
        status: 'pending',
        content
      })
      emit({
        id: 'write-permission',
        method: 'session/request_permission',
        params: {
          sessionId: 'native-session',
          toolCall: { toolCallId: 'write', kind: 'edit', content },
          options: [
            { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
            { optionId: 'deny', name: 'Deny', kind: 'reject_once' }
          ]
        }
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
    if (scenario.startsWith('codex-network-') || scenario === 'codex-execpolicy') {
      emit({
        id: 'approval',
        method: 'item/commandExecution/requestApproval',
        params: {
          threadId: 'native-session',
          turnId: 'turn',
          itemId: 'tool',
          availableDecisions: [
            scenario === 'codex-execpolicy'
              ? { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['git', 'status'] } }
              : {
                  applyNetworkPolicyAmendment: {
                    network_policy_amendment: {
                      host: 'example.com',
                      action: scenario.endsWith('deny') ? 'deny' : 'allow'
                    }
                  }
                },
            'cancel'
          ]
        }
      })
    } else if (scenario.startsWith('codex-approval-context-')) {
      const type = scenario.endsWith('file') ? 'fileChange' : 'commandExecution'
      if (turn === 1)
        emit({
          method: 'item/started',
          params: {
            threadId: 'native-session',
            turnId: 'turn',
            item: {
              id: 'tool',
              type,
              ...(type === 'fileChange'
                ? { changes: [{ path: join(cwd, 'example.txt'), kind: { type: 'add' }, diff: 'review this content' }] }
                : { command: 'echo fixture', cwd })
            }
          }
        })
      emit({
        id: 'approval',
        method: `item/${type}/requestApproval`,
        params: { threadId: 'native-session', turnId: 'turn', itemId: 'tool', reason: 'Review action' }
      })
    } else if (
      scenario === 'permission' ||
      scenario === 'standalone-permission' ||
      (scenario === 'codex-full-access' && turn === 1)
    ) {
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
  } else if (id === 'write-permission') {
    if (scenario === 'approved-write-later-turn') {
      finish()
      return
    }
    if (message.result?.outcome?.optionId !== 'allow') {
      text(JSON.stringify(message.result))
      finish()
      return
    }
    emit({
      id: 'approved-write',
      method: 'fs/write_text_file',
      params: {
        sessionId: 'native-session',
        path: `${cwd}/approved.txt`,
        content: scenario === 'approved-write-changed' ? 'different content' : 'approved content'
      }
    })
  } else if (id === 'approved-write') {
    if (scenario === 'approved-write-repeated') {
      emit({
        id: 'write-again',
        method: 'fs/write_text_file',
        params: {
          sessionId: 'native-session',
          path: `${cwd}/approved.txt`,
          content: 'approved content'
        }
      })
    } else {
      text(JSON.stringify(message.result ?? message.error))
      finish()
    }
  } else if (id === 'write-again' || id === 'elicitation') {
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
        args: ['-e', 'process.stdout.write(process.env.APPROVAL_ENV)'],
        env: [{ name: 'APPROVAL_ENV', value: 'terminal-result' }],
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
