import { Field, FieldContent, Textarea } from '@cherrystudio/ui'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { PromptVariablesTooltip } from '../../PromptVariablesTooltip'
import type { AgentFormState } from '../descriptor'
import { FieldHeader } from './FieldHeader'

interface Props {
  form: AgentFormState
  onChange: (patch: Partial<AgentFormState>) => void
}

/**
 * Covers: instructions (the Agent's system prompt). Scaffold uses a plain
 * textarea; a richer editor with token counting lands in a follow-up pass
 * once the design reference for it is finalized.
 */
const PromptSection: FC<Props> = ({ form, onChange }) => {
  const { t } = useTranslation()
  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <h3 className="mb-1 text-base text-foreground">{t('library.config.agent.section.prompt.title')}</h3>
        <p className="text-muted-foreground/60 text-xs">{t('library.config.agent.section.prompt.desc')}</p>
      </div>

      <Field className="gap-1.5">
        <FieldHeader
          label={
            <span className="flex items-center gap-1.5">
              <span>{t('library.config.agent.field.instructions.label')}</span>
              <PromptVariablesTooltip />
            </span>
          }
        />
        <FieldContent>
          <Textarea.Input
            value={form.instructions}
            onChange={(e) => onChange({ instructions: e.target.value })}
            placeholder={t('library.config.agent.field.instructions.placeholder')}
            className="min-h-80 rounded-xs border border-border/20 bg-accent/15 px-3 py-2 font-mono text-foreground text-xs leading-relaxed transition-all focus:border-border/40 focus:bg-accent/20"
          />
        </FieldContent>
      </Field>
    </div>
  )
}

export default PromptSection
