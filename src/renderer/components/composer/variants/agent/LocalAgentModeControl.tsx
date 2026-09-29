import { Route } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { LocalAgentSessionInfo } from '@shared/ai/localAgent'

const modeNameKeys = new Map(
  Object.entries({
    default: 'local_agents.modes.default',
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

export function LocalAgentModeControl({
  sessionId,
  mode,
  disabled
}: {
  sessionId: string
  mode: NonNullable<LocalAgentSessionInfo['mode']>
  disabled: boolean
}) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  if (mode.options.length < 2) return null
  const options = mode.options.map((option) => {
    const nameKey = modeNameKeys.get(option.name.toLowerCase())
    const descriptionKey = option.description ? modeDescriptionKeys.get(option.description) : undefined
    return {
      ...option,
      name: nameKey ? t(nameKey) : option.name,
      description: descriptionKey ? t(descriptionKey) : option.description
    }
  })
  const select = async (value: string) => {
    if (saving || disabled || value === mode.currentValue) return
    setSaving(true)
    try {
      await ipcApi.request('ai.local_agents.set_mode', { sessionId, configId: mode.id, value })
    } catch (error) {
      toast.error(String(error))
    } finally {
      setSaving(false)
    }
  }
  return (
    <Select value={mode.currentValue} onValueChange={select} disabled={disabled || saving}>
      <SelectTrigger
        aria-label={t('local_agents.mode')}
        className="h-7 w-auto max-w-40 gap-1.5 border-0 bg-transparent px-2 text-xs shadow-none">
        <Route className="size-3.5 shrink-0 text-muted-foreground" />
        <SelectValue>
          {options.find((option) => option.value === mode.currentValue)?.name ?? mode.currentValue}
        </SelectValue>
      </SelectTrigger>
      <SelectContent side="top" className="max-w-80">
        {options.map((option) => (
          <SelectItem
            className="py-2 not-last:mb-1 data-[state=checked]:bg-accent! data-[state=checked]:text-accent-foreground! [&_.lucide-check]:text-muted-foreground!"
            key={option.value}
            value={option.value}
            textValue={option.name}>
            <div className="min-w-0">
              <div>{option.name}</div>
              {option.description && (
                <div className="mt-0.5 whitespace-normal text-xs text-muted-foreground">{option.description}</div>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
