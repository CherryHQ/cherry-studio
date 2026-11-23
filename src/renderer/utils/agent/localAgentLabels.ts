import type { TFunction } from 'i18next'

import { reasoningEffortLabel } from '@renderer/utils/reasoning'
import type { LocalAgentConfigOption, LocalAgentSelection } from '@shared/ai/localAgent'

const modeNameKeys = new Map(
  Object.entries({
    default: 'local_agents.modes.default',
    'always ask': 'local_agents.modes.always_ask',
    auto: 'code.adv.permission_modes.auto',
    'bypass permissions': 'code.adv.permission_modes.bypass_high_risk',
    yolo: 'code.adv.permission_modes.bypass_high_risk',
    'full access': 'code.adv.permission_modes.full_access_high_risk',
    'read only': 'code.adv.permission_modes.read_only',
    workspace: 'code.adv.permission_modes.workspace',
    delegate: 'local_agents.modes.delegate',
    'accept edits': 'local_agents.modes.accept_edits',
    "don't ask": 'local_agents.modes.dont_ask',
    code: 'local_agents.modes.code',
    ask: 'local_agents.modes.ask',
    debug: 'local_agents.modes.debug',
    orchestrator: 'local_agents.modes.orchestrator',
    plan: 'local_agents.modes.plan'
  })
)

const HIGH_RISK_MODE_IDENTIFIERS = new Set([
  'bypass permissions',
  'bypass all permissions',
  'full access',
  'bypasspermissions',
  'bypass_permissions',
  'bypass-permissions',
  'fullaccess',
  'bypass',
  'yolo',
  'autopilot',
  'auto-approve',
  'auto_approve',
  'allow_all',
  'danger-full-access'
])

const UNSANDBOXED_VALUES = new Set(['false', 'off', 'disabled', 'none', 'local', 'local_environment'])
const UNSANDBOXED_NAMES = new Set(['local environment', 'local'])

export type LocalCanonicalPermissionMode = 'plan' | 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions'

export interface UnifiedLocalPermissionOption {
  canonicalMode: LocalCanonicalPermissionMode
  value: string
  name: string
  description: string
  dangerous: boolean
}

export interface UnifiedLocalPermissionProjection {
  id: string
  currentValue: string
  currentCanonicalMode?: LocalCanonicalPermissionMode
  options: UnifiedLocalPermissionOption[]
}

const CANONICAL_PERMISSION_MODE_ORDER: readonly LocalCanonicalPermissionMode[] = [
  'plan',
  'default',
  'acceptEdits',
  'auto',
  'bypassPermissions'
]

const CANONICAL_PERMISSION_MODE_SPECS: Record<
  LocalCanonicalPermissionMode,
  { titleKey: string; titleFallback: string; descriptionKey: string; descriptionFallback: string; dangerous: boolean }
> = {
  plan: {
    titleKey: 'agent.settings.tooling.permissionMode.plan.title',
    titleFallback: 'Plan Only',
    descriptionKey: 'agent.settings.tooling.permissionMode.plan.description',
    descriptionFallback: 'Plans without editing files. Only read-only or vetted commands run.',
    dangerous: false
  },
  default: {
    titleKey: 'agent.settings.tooling.permissionMode.default.title',
    titleFallback: 'Ask Before Acting',
    descriptionKey: 'agent.settings.tooling.permissionMode.default.description',
    descriptionFallback: 'Asks before editing files or running commands.',
    dangerous: false
  },
  acceptEdits: {
    titleKey: 'agent.settings.tooling.permissionMode.acceptEdits.title',
    titleFallback: 'Auto-accept Edits',
    descriptionKey: 'agent.settings.tooling.permissionMode.acceptEdits.description',
    descriptionFallback: 'Edits files freely. Asks before commands.',
    dangerous: false
  },
  auto: {
    titleKey: 'agent.settings.tooling.permissionMode.auto.title',
    titleFallback: 'Approve for Me',
    descriptionKey: 'agent.settings.tooling.permissionMode.auto.description',
    descriptionFallback: 'Runs without routine prompts. A safety check blocks risky actions.',
    dangerous: false
  },
  bypassPermissions: {
    titleKey: 'agent.settings.tooling.permissionMode.bypassPermissions.title',
    titleFallback: 'Full Access',
    descriptionKey: 'agent.settings.tooling.permissionMode.bypassPermissions.description',
    descriptionFallback: 'Skips permission checks. Can delete files and use the network.',
    dangerous: true
  }
}

const NATIVE_PERMISSION_CLASSIFIERS: ReadonlyArray<{
  canonicalMode: LocalCanonicalPermissionMode
  identifiers: ReadonlyMap<string, number>
}> = [
  {
    canonicalMode: 'bypassPermissions',
    identifiers: new Map([
      ['bypasspermissions', 0],
      ['bypass_permissions', 0],
      ['bypass-permissions', 0],
      ['bypass permissions', 0],
      ['bypass all permissions', 0],
      ['fullaccess', 1],
      ['full access', 1],
      ['danger-full-access', 2],
      ['bypass', 3],
      ['yolo', 4],
      ['autopilot', 5],
      ['auto-approve', 5],
      ['auto_approve', 5],
      ['allow_all', 6]
    ])
  },
  {
    canonicalMode: 'plan',
    identifiers: new Map([
      ['plan', 0],
      ['readonly', 1],
      ['read only', 1],
      ['read-only', 1],
      ['read_only', 1],
      ['ask', 2]
    ])
  },
  {
    canonicalMode: 'auto',
    identifiers: new Map([
      ['auto', 0],
      ['smart_approve', 1],
      ['smart approve', 1],
      ['smart-approve', 1]
    ])
  },
  {
    canonicalMode: 'acceptEdits',
    identifiers: new Map([
      ['acceptedits', 0],
      ['accept_edits', 0],
      ['accept-edits', 0],
      ['accept edits', 0],
      ['auto-approve edits', 0],
      ['auto-edit', 1],
      ['auto edit', 1],
      ['autoedit', 1],
      ['auto_edit', 1],
      ['workspace-write', 2],
      ['workspace_session', 2],
      ['workspace', 3],
      ['edit', 4],
      ['build', 5],
      ['code', 6],
      ['agent', 7]
    ])
  },
  {
    canonicalMode: 'default',
    identifiers: new Map([
      ['default', 0],
      ['always ask', 1],
      ['alwaysask', 1],
      ['always-ask', 1],
      ['always_ask', 1],
      ['guarded', 2],
      ['approve', 2],
      ['manual', 3],
      ['supervised', 4]
    ])
  }
]

const PERMISSION_CONFIG_OPTION_IDENTIFIERS = new Set([
  'permission_mode',
  'permission mode',
  'permissionmode',
  'permissions',
  'approval_mode',
  'approval mode'
])

const THOUGHT_CONFIG_OPTION_IDENTIFIERS = new Set([
  'thought_level',
  'thoughtlevel',
  'reasoning_effort',
  'reasoningeffort',
  'reasoning',
  'thinking',
  'effort',
  'thinking_effort',
  'thinking_level',
  'thinking_levels',
  'levels'
])

const THOUGHT_CHOICE_IDENTIFIERS = new Set([
  'off',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'auto',
  'default'
])

export function classifyNativePermissionMode(
  option: { value: string; name: string },
  presetId?: string
): { canonicalMode: LocalCanonicalPermissionMode; priority: number } | undefined {
  // Pi uses ACP `mode` exclusively to carry thinking levels rather than permission policies.
  if (presetId === 'pi-acp') return undefined
  const value = option.value.trim().toLowerCase()
  const name = option.name.trim().toLowerCase()

  if (presetId === 'goose' && (value === 'auto' || name === 'auto')) {
    return { canonicalMode: 'bypassPermissions', priority: 1 }
  }
  if (presetId === 'minimax' && (value === 'ask' || name === 'ask')) {
    return { canonicalMode: 'default', priority: 1 }
  }
  if (presetId === 'copilot' && (value === 'agent' || name === 'agent')) {
    return { canonicalMode: 'default', priority: 1 }
  }
  if (presetId === 'cursor' && (value === 'agent' || name === 'agent')) {
    return { canonicalMode: 'acceptEdits', priority: 1 }
  }
  if (name === 'default' && value !== 'plan') {
    return { canonicalMode: 'default', priority: 0 }
  }
  if (presetId === 'hermes' && value === 'session') {
    return { canonicalMode: 'auto', priority: 0 }
  }
  if (presetId === 'cline' && value === 'act') {
    return { canonicalMode: 'default', priority: 1 }
  }

  for (const classifier of NATIVE_PERMISSION_CLASSIFIERS) {
    const valuePriority = classifier.identifiers.get(value)
    const namePriority = classifier.identifiers.get(name)
    if (valuePriority !== undefined && namePriority !== undefined) {
      return { canonicalMode: classifier.canonicalMode, priority: Math.min(valuePriority, namePriority) }
    }
    if (valuePriority !== undefined) {
      return { canonicalMode: classifier.canonicalMode, priority: valuePriority }
    }
    if (namePriority !== undefined) {
      return { canonicalMode: classifier.canonicalMode, priority: namePriority }
    }
  }
  return undefined
}

export function isUnifiedLocalPermissionMode(mode?: LocalAgentSelection, presetId?: string): boolean {
  if (!mode || mode.options.length < 2) return false
  const categories = new Set<LocalCanonicalPermissionMode>()
  for (const option of mode.options) {
    const match = classifyNativePermissionMode(option, presetId)
    if (match) categories.add(match.canonicalMode)
    if (categories.size >= 2) return true
  }
  return false
}

export function findLocalPermissionConfigOption(
  options: LocalAgentConfigOption[] | undefined,
  presetId?: string
): LocalAgentSelection | undefined {
  if (!options?.length) return undefined
  for (const option of options) {
    if (option.type !== 'select') continue
    const id = option.id.trim().toLowerCase()
    const name = option.name.trim().toLowerCase()
    if (!PERMISSION_CONFIG_OPTION_IDENTIFIERS.has(id) && !PERMISSION_CONFIG_OPTION_IDENTIFIERS.has(name)) continue
    const selection: LocalAgentSelection = {
      id: option.id,
      currentValue: String(option.currentValue),
      options: option.options
        .flatMap((choice) => ('group' in choice ? choice.options : [choice]))
        .map((choice) => ({
          value: choice.value,
          name: choice.name,
          description: choice.description ?? undefined
        }))
    }
    if (isUnifiedLocalPermissionMode(selection, presetId)) return selection
  }
  return undefined
}

export function isLocalThoughtConfigOption(
  option: LocalAgentConfigOption
): option is Extract<LocalAgentConfigOption, { type: 'select' }> {
  if (option.type !== 'select') return false
  const flattened = option.options.flatMap((choice) => ('group' in choice ? choice.options : [choice]))
  if (flattened.length <= 1) return false
  if (option.category === 'thought_level') return true
  const id = option.id.trim().toLowerCase()
  const name = option.name.trim().toLowerCase()
  if (!THOUGHT_CONFIG_OPTION_IDENTIFIERS.has(id) && !THOUGHT_CONFIG_OPTION_IDENTIFIERS.has(name)) return false
  const recognized = flattened.filter(
    (choice) =>
      THOUGHT_CHOICE_IDENTIFIERS.has(choice.value.trim().toLowerCase()) ||
      THOUGHT_CHOICE_IDENTIFIERS.has(choice.name.trim().toLowerCase())
  )
  return recognized.length >= 2
}

export function resolveUnifiedLocalPermissionModes(
  mode: LocalAgentSelection | undefined,
  t: TFunction,
  presetId?: string
): UnifiedLocalPermissionProjection | undefined {
  if (!mode || mode.options.length < 2) return undefined

  const grouped = new Map<
    LocalCanonicalPermissionMode,
    Array<{ option: LocalAgentSelection['options'][number]; priority: number }>
  >()

  for (const option of mode.options) {
    const match = classifyNativePermissionMode(option, presetId)
    if (!match) continue
    const list = grouped.get(match.canonicalMode)
    if (list) list.push({ option, priority: match.priority })
    else grouped.set(match.canonicalMode, [{ option, priority: match.priority }])
  }

  const options: UnifiedLocalPermissionOption[] = []
  let currentCanonicalMode: LocalCanonicalPermissionMode | undefined

  for (const canonicalMode of CANONICAL_PERMISSION_MODE_ORDER) {
    const candidates = grouped.get(canonicalMode)
    if (!candidates?.length) continue
    const activeMatch = candidates.find((entry) => entry.option.value === mode.currentValue)
    const chosen =
      activeMatch ?? candidates.reduce((best, entry) => (entry.priority < best.priority ? entry : best), candidates[0])
    if (chosen.option.value === mode.currentValue) currentCanonicalMode = canonicalMode
    const spec = CANONICAL_PERMISSION_MODE_SPECS[canonicalMode]
    options.push({
      canonicalMode,
      value: chosen.option.value,
      name: t(spec.titleKey, spec.titleFallback),
      description: t(spec.descriptionKey, spec.descriptionFallback),
      dangerous: spec.dangerous
    })
  }

  if (options.length < 2) return undefined

  return {
    id: mode.id,
    currentValue: mode.currentValue,
    currentCanonicalMode,
    options
  }
}

export type LocalPermissionRiskLevel = 'readonly' | 'ask' | 'auto_edit' | 'full_access'

const READONLY_MODE_IDENTIFIERS = new Set(['plan', 'read only', 'readonly', 'read-only', 'ask'])
const AUTO_EDIT_MODE_IDENTIFIERS = new Set([
  'accept edits',
  'auto-approve edits',
  'acceptedits',
  'accept_edits',
  'accept-edits',
  'auto edit',
  'auto-edit',
  'auto',
  'code',
  'build',
  'agent',
  'workspace',
  'workspace_session',
  'workspace-write'
])
const DEFAULT_NON_PLAN_IDENTIFIERS = [
  'default',
  'approve',
  'workspace',
  'workspace-write',
  'always ask',
  'guarded',
  'edit',
  'ask',
  'agent',
  'code',
  'build'
]

export function isHighRiskLocalOption({
  kind,
  optionId,
  value,
  name
}: {
  kind: 'mode' | 'thought' | 'config'
  optionId: string
  value: string | boolean
  name?: string
}): boolean {
  if (kind === 'mode') {
    const normalizedValue = String(value).trim().toLowerCase()
    const normalizedName = name?.trim().toLowerCase()
    return (
      HIGH_RISK_MODE_IDENTIFIERS.has(normalizedValue) ||
      (!!normalizedName && HIGH_RISK_MODE_IDENTIFIERS.has(normalizedName))
    )
  }
  if (kind === 'config' && optionId === 'allow_all') {
    return value === true || ['true', 'on'].includes(String(value).trim().toLowerCase())
  }
  if (kind === 'config' && optionId === 'sandbox') {
    const normalizedValue = String(value).trim().toLowerCase()
    const normalizedName = name?.trim().toLowerCase()
    return (
      value === false ||
      UNSANDBOXED_VALUES.has(normalizedValue) ||
      (!!normalizedName && UNSANDBOXED_NAMES.has(normalizedName))
    )
  }
  return false
}

export function getLocalOptionRiskLevel(params: {
  kind: 'mode' | 'thought' | 'config'
  optionId: string
  value: string | boolean
  name?: string
}): LocalPermissionRiskLevel {
  if (isHighRiskLocalOption(params)) return 'full_access'
  if (params.kind === 'mode') {
    const normalizedValue = String(params.value).trim().toLowerCase()
    const normalizedName = params.name?.trim().toLowerCase()
    if (
      READONLY_MODE_IDENTIFIERS.has(normalizedValue) ||
      (!!normalizedName && READONLY_MODE_IDENTIFIERS.has(normalizedName))
    ) {
      return 'readonly'
    }
    if (
      AUTO_EDIT_MODE_IDENTIFIERS.has(normalizedValue) ||
      (!!normalizedName && AUTO_EDIT_MODE_IDENTIFIERS.has(normalizedName))
    ) {
      return 'auto_edit'
    }
  }
  return 'ask'
}

export function findLocalPlanModeOption(mode?: LocalAgentSelection) {
  if (!mode || mode.options.length < 2) return undefined
  const exactPlan = mode.options.find((option) => {
    const value = option.value.trim().toLowerCase()
    const name = option.name.trim().toLowerCase()
    return value === 'plan' || name === 'plan'
  })
  if (exactPlan) return exactPlan
  return mode.options.find((option) => {
    const value = option.value.trim().toLowerCase()
    const name = option.name.trim().toLowerCase()
    return ['readonly', 'read-only', 'read_only'].includes(value) || name === 'read only'
  })
}

export function findLocalDefaultNonPlanOption(mode: LocalAgentSelection, planValue: string) {
  const candidates = mode.options.filter(
    (option) =>
      option.value !== planValue &&
      !isHighRiskLocalOption({ kind: 'mode', optionId: mode.id, value: option.value, name: option.name })
  )
  for (const preferred of DEFAULT_NON_PLAN_IDENTIFIERS) {
    const match = candidates.find(
      (option) => option.value.trim().toLowerCase() === preferred || option.name.trim().toLowerCase() === preferred
    )
    if (match) return match
  }
  return candidates[0]
}

// Translate recognized native descriptions exactly; custom permission semantics stay intact.
const modeDescriptionKeys = new Map(
  Object.entries({
    'Prompts for permission on first use of each tool': 'local_agents.modes.codebuddy_default_description',
    'Automatically accepts file edit permissions for the session': 'local_agents.modes.codebuddy_accept_description',
    'Agent can analyze but not modify files or execute commands': 'local_agents.modes.codebuddy_plan_description',
    'An AI classifier reviews actions that would normally prompt: safe ones are auto-approved, risky ones are denied. If the classifier is unavailable, the action falls back to a prompt (or is denied when prompts cannot be shown)':
      'local_agents.modes.codebuddy_auto_description',
    'Does not show permission prompts; pre-approved and safe read-only actions run, everything else that would prompt is denied':
      'local_agents.modes.codebuddy_dont_ask_description',
    'Skips all permission prompts': 'local_agents.modes.codebuddy_bypass_description',
    'Skips ALL permission checks including dangerous commands for all agents':
      'local_agents.modes.codebuddy_full_description',
    'Permissions managed by parent session': 'local_agents.modes.codebuddy_delegate_description',
    'Ask before edits.': 'local_agents.modes.default_description',
    'Auto-allow workspace and /tmp edits; still asks for sensitive paths.':
      'local_agents.modes.accept_edits_description',
    'Auto-allow file edits for this session except sensitive paths.': 'local_agents.modes.dont_ask_description',
    'The default agent. Executes tools based on configured permissions.': 'local_agents.modes.code_description',
    'Get answers and explanations without making changes to the codebase.': 'local_agents.modes.ask_description',
    'Diagnose and fix software issues with systematic debugging methodology.': 'local_agents.modes.debug_description',
    'Coordinate complex tasks by delegating to specialized agents in parallel.':
      'local_agents.modes.orchestrator_description',
    'Plan mode. Can only edit plan files; all other filesystem mutations are denied.':
      'local_agents.modes.plan_description'
  })
)

const agentModeLabels = new Map<string, Record<string, string>>([
  [
    'antigravity-acp',
    {
      'Auto Edit': 'code.adv.permission_modes.auto_edit',
      YOLO: 'code.adv.permission_modes.bypass_high_risk',
      'Default permission prompt flow': 'local_agents.modes.antigravity_default_description',
      'Auto-approve file edit tools': 'local_agents.modes.antigravity_edit_description',
      'Auto-approve all tools': 'local_agents.modes.antigravity_yolo_description'
    }
  ],
  [
    'copilot',
    {
      Agent: 'common.agent',
      Autopilot: 'local_agents.modes.autopilot',
      'Default agent mode for conversational interactions': 'local_agents.modes.copilot_agent_description',
      'Plan mode for creating and executing multi-step plans': 'local_agents.modes.copilot_plan_description',
      'Autonomous mode that enables allow-all and runs until task completion without user interaction (experimental)':
        'local_agents.modes.copilot_autopilot_description'
    }
  ],
  [
    'cursor',
    {
      Agent: 'common.agent',
      'Full agent capabilities with tool access': 'local_agents.modes.cursor_agent_description',
      'Read-only mode for planning and designing before implementation': 'local_agents.modes.cursor_plan_description',
      'Q&A mode - no edits or command execution': 'local_agents.modes.cursor_ask_description'
    }
  ],
  [
    'opencode',
    {
      build: 'message.tools.activity.build',
      'Plan mode. Disallows all edit tools.': 'local_agents.modes.opencode_plan_description'
    }
  ],
  [
    'pi-acp',
    {
      'Thinking: off': 'assistants.settings.reasoning_effort.off',
      'Thinking: minimal': 'assistants.settings.reasoning_effort.minimal',
      'Thinking: low': 'assistants.settings.reasoning_effort.low',
      'Thinking: medium': 'assistants.settings.reasoning_effort.medium',
      'Thinking: high': 'assistants.settings.reasoning_effort.high'
    }
  ],
  [
    'qwen',
    {
      'Auto Edit': 'code.adv.permission_modes.auto_edit'
    }
  ]
])

function translateLabel<T extends { name: string; description?: string | null }>(
  item: T,
  labels: Record<string, string>,
  t: TFunction
): T {
  return {
    ...item,
    name: Object.hasOwn(labels, item.name) ? t(labels[item.name]) : item.name,
    description:
      item.description && Object.hasOwn(labels, item.description) ? t(labels[item.description]) : item.description
  }
}

export function localAgentModeOptions(mode: LocalAgentSelection, t: TFunction, presetId?: string) {
  return mode.options.map((option) => {
    const nameKey = modeNameKeys.get(option.name.toLowerCase())
    const descriptionKey = option.description ? modeDescriptionKeys.get(option.description) : undefined
    const labels = presetId ? agentModeLabels.get(presetId) : undefined
    const translated = labels ? translateLabel(option, labels, t) : option
    return {
      ...translated,
      name: nameKey ? t(nameKey) : translated.name,
      description: descriptionKey ? t(descriptionKey) : translated.description
    }
  })
}

const codebuddyConfigLabels = new Map<string, Record<string, string>>([
  [
    'sandbox',
    {
      Sandbox: 'local_agents.config.sandbox',
      'Run shell commands inside the sandbox-cli isolation layer': 'local_agents.config.sandbox_description',
      'Sandbox Environment': 'local_agents.config.sandbox_environment',
      'Bash/PowerShell commands run inside the sandbox and require escalation to touch the host':
        'local_agents.config.sandbox_environment_description',
      'Local Environment': 'local_agents.config.local_environment',
      'Commands run with full user permissions (no sandbox isolation)':
        'local_agents.config.local_environment_description'
    }
  ],
  [
    'multitask',
    {
      Multitask: 'local_agents.config.multitask',
      'Coordinate detached workers while keeping the current agent mode': 'local_agents.config.multitask_description'
    }
  ]
])

const configLabels = new Map([
  ['codebuddy-code', codebuddyConfigLabels],
  [
    'copilot',
    new Map<string, Record<string, string>>([
      [
        'allow_all',
        {
          'Allow All': 'local_agents.config.allow_all',
          'Controls whether Copilot prompts for approval before using tools, accessing paths, or fetching URLs.':
            'local_agents.config.allow_all_description',
          On: 'common.enabled',
          Off: 'common.disabled',
          'Automatically approve all tool, path, and URL requests': 'local_agents.config.allow_all_on_description',
          'Require approval for tool, path, and URL requests': 'local_agents.config.allow_all_off_description'
        }
      ]
    ])
  ]
])

const configNameKeys: Record<string, string> = {
  Model: 'common.model',
  'Select the model for this session': 'local_agents.config.model_description',
  Mode: 'local_agents.mode',
  'Session Mode': 'local_agents.mode',
  Thinking: 'assistants.settings.reasoning_effort.label',
  Reasoning: 'assistants.settings.reasoning_effort.label',
  Effort: 'assistants.settings.reasoning_effort.label',
  'Thinking levels': 'assistants.settings.reasoning_effort.label',
  Levels: 'assistants.settings.reasoning_effort.label',
  'Set the reasoning effort for this session': 'local_agents.config.reasoning_description',
  'Available effort levels for this model': 'local_agents.config.effort_description',
  'Context size': 'local_agents.config.context_size',
  'Context window': 'models.detail.context_window',
  Temperature: 'library.config.basic.temperature',
  'Max tokens': 'library.config.basic.max_tokens',
  'Answer detail': 'local_agents.config.answer_detail',
  Verbosity: 'local_agents.config.answer_detail',
  'Detail levels': 'local_agents.config.answer_detail',
  'Response length': 'local_agents.config.response_length',
  Notifications: 'settings.notification.title'
}

const configChoiceKeys = new Map<string, Record<string, string>>([
  ['Context size', { Small: 'local_agents.config.small', Large: 'local_agents.config.large' }],
  ...['Answer detail', 'Verbosity'].map((name): [string, Record<string, string>] => [
    name,
    {
      Brief: 'local_agents.config.brief',
      Detailed: 'agent.speed.summary.detailed',
      'Include explanation': 'local_agents.config.include_explanation'
    }
  ])
])

export function localAgentConfigOptions(options: LocalAgentConfigOption[], presetId: string | undefined, t: TFunction) {
  const config = presetId ? configLabels.get(presetId) : undefined
  return options.map((option) => {
    const labels = config?.get(option.id) ?? {}
    const translated = translateLabel(option, { ...configNameKeys, ...labels }, t)
    const translate = (choice: { value: string; name: string; description?: string | null }) => {
      if (option.category === 'mode')
        return localAgentModeOptions(
          {
            id: option.id,
            currentValue: String(option.currentValue),
            options: [{ ...choice, description: choice.description ?? undefined }]
          },
          t,
          presetId
        )[0]
      const result = translateLabel(
        choice,
        {
          ...configChoiceKeys.get(option.name),
          ...labels
        },
        t
      )
      return option.category === 'thought_level'
        ? { ...result, name: reasoningEffortLabel(choice.value, t, result.name) }
        : result
    }
    return translated.type === 'select'
      ? {
          ...translated,
          options: translated.options.map((choice) =>
            'group' in choice
              ? {
                  ...(option.category === 'model'
                    ? choice
                    : translateLabel(choice, { ...configNameKeys, ...labels }, t)),
                  options: option.category === 'model' ? choice.options : choice.options.map(translate)
                }
              : option.category === 'model'
                ? choice
                : translate(choice)
          )
        }
      : translated
  })
}
