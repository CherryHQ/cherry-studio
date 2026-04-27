import { Input, Textarea } from '@cherrystudio/ui'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import type { AgentFormState } from '../descriptor'

interface Props {
  form: AgentFormState
  onChange: (patch: Partial<AgentFormState>) => void
}

/**
 * Covers: configuration.max_turns, configuration.env_vars. Matches the
 * legacy AgentSettings **Advanced** tab exactly — soul / heartbeat
 * switches stayed in the Essential (Basic) tab, not here.
 */
const AdvancedSection: FC<Props> = ({ form, onChange }) => {
  const { t } = useTranslation()

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h3 className="mb-1 text-base text-foreground">{t('library.config.agent.section.advanced.title')}</h3>
        <p className="text-xs text-muted-foreground/60">{t('library.config.agent.section.advanced.desc')}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm text-muted-foreground/60">{t('library.config.agent.field.max_turns.label')}</label>
          <span className="font-mono text-xs text-foreground/70">{form.maxTurns || 0}</span>
        </div>
        <Input
          type="number"
          min={0}
          max={100}
          value={form.maxTurns || ''}
          onChange={(e) => onChange({ maxTurns: Number(e.target.value) || 0 })}
          placeholder="0"
          className="rounded-xs border-border/20 bg-accent/15 text-xs focus:border-border/40 focus:bg-accent/20"
        />
        <span className="text-xs text-muted-foreground/55">{t('library.config.agent.field.max_turns.help')}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm text-muted-foreground/60">{t('library.config.agent.field.env_vars.label')}</label>
        <Textarea.Input
          value={form.envVarsText}
          onChange={(e) => onChange({ envVarsText: e.target.value })}
          placeholder={'KEY=value\nANOTHER_KEY=another_value'}
          className="min-h-30 rounded-xs border-border/20 bg-accent/15 px-3 py-2 font-mono text-xs focus:border-border/40 focus:bg-accent/20"
        />
        <span className="text-xs text-muted-foreground/55">{t('library.config.agent.field.env_vars.help')}</span>
      </div>
    </div>
  )
}

export default AdvancedSection
