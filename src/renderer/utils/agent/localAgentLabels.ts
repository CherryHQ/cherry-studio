import type { TFunction } from 'i18next'

import { reasoningEffortLabel } from '@renderer/utils/reasoning'
import type { LocalAgentConfigOption, LocalAgentSelection } from '@shared/ai/localAgent'

const modeNameKeys = new Map(
  Object.entries({
    default: 'local_agents.modes.default',
    'always ask': 'local_agents.modes.always_ask',
    auto: 'code.adv.permission_modes.auto',
    'bypass permissions': 'code.adv.permission_modes.bypass_high_risk',
    'full access': 'code.adv.permission_modes.full_access_high_risk',
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
