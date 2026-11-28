import { app } from 'electron'

import { parseBuiltinAgentDefaults } from '@data/services/builtinAgentDefaults'
import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'

import assistantDefinition from '../../../../../resources/builtin-agents/cherry-assistant/agent.json'
import supportDefinition from '../../../../../resources/builtin-agents/cherry-support/agent.json'

// Embed the package defaults so database startup does not depend on reading a resource file.
const seedDefinitions = {
  [BUILTIN_AGENT_ROLE.ASSISTANT]: assistantDefinition,
  [BUILTIN_AGENT_ROLE.SUPPORT]: supportDefinition
}

function getSeedLocale(): 'en-US' | 'zh-CN' {
  try {
    return app.getPreferredSystemLanguages()[0]?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
  } catch {
    return 'en-US'
  }
}

export function loadBuiltinAgentSeedDefaults(role: keyof typeof seedDefinitions, locale = getSeedLocale()) {
  const {
    name,
    type,
    configuration,
    disabled_tools: disabledTools
  }: {
    name: Record<typeof locale, string>
    type: string
    configuration: unknown
    disabled_tools?: string[]
  } = seedDefinitions[role]
  return parseBuiltinAgentDefaults(role, { name: name[locale], type, configuration, disabledTools })
}
