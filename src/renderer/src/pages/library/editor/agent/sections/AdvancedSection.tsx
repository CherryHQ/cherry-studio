import { EditableNumber, Textarea } from '@cherrystudio/ui'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { FieldHeader } from '../../FieldHeader'
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
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-1 text-base text-foreground">{t('library.config.agent.section.advanced.title')}</h3>
        <p className="text-muted-foreground/80 text-xs">{t('library.config.agent.section.advanced.desc')}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <FieldHeader
          label={t('library.config.agent.field.max_turns.label')}
          hint={t('library.config.agent.field.max_turns.help')}
        />
        <EditableNumber
          block
          min={0}
          max={100}
          step={1}
          precision={0}
          align="start"
          changeOnBlur
          value={form.maxTurns || null}
          onChange={(v) => onChange({ maxTurns: typeof v === 'number' ? v : 0 })}
          placeholder="0"
          className="rounded-xs border-border/20 bg-accent/15 text-xs focus-visible:border-border/40 focus-visible:bg-accent/20 focus-visible:ring-0"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <FieldHeader
          label={t('library.config.agent.field.env_vars.label')}
          hint={t('library.config.agent.field.env_vars.help')}
        />
        <Textarea.Input
          value={form.envVarsText}
          onChange={(e) => onChange({ envVarsText: e.target.value })}
          placeholder={'KEY=value\nANOTHER_KEY=another_value'}
          className="min-h-30 rounded-xs border-border/20 bg-accent/15 px-3 py-2 font-mono text-xs focus:border-border/40 focus:bg-accent/20"
        />
      </div>
    </div>
  )
}

export default AdvancedSection
