import { Tooltip } from '@cherrystudio/ui'
import { HelpCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** Variable catalogue — mirrors legacy `assistants.presets.add.prompt.variables.tip.content`. */
const PROMPT_VARIABLES: { name: string; i18n: string }[] = [
  { name: '{{date}}', i18n: 'library.config.prompt.vars.date' },
  { name: '{{time}}', i18n: 'library.config.prompt.vars.time' },
  { name: '{{datetime}}', i18n: 'library.config.prompt.vars.datetime' },
  { name: '{{system}}', i18n: 'library.config.prompt.vars.os' },
  { name: '{{arch}}', i18n: 'library.config.prompt.vars.arch' },
  { name: '{{language}}', i18n: 'library.config.prompt.vars.language' },
  { name: '{{model_name}}', i18n: 'library.config.prompt.vars.model_name' },
  { name: '{{username}}', i18n: 'library.config.prompt.vars.username' }
]

export function PromptVariablesTooltip() {
  const { t } = useTranslation()

  const content = (
    <div className="min-w-[200px]">
      <div className="mb-1.5 font-medium text-foreground text-xs">{t('library.config.prompt.variables_title')}</div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-muted-foreground text-xs">
        {PROMPT_VARIABLES.map((v) => (
          <div key={v.name} className="contents">
            <span className="text-foreground/80">{v.name}</span>
            <span>{t(v.i18n)}</span>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <Tooltip content={content} placement="top" classNames={{ content: 'max-w-none' }}>
      <HelpCircle
        size={11}
        role="img"
        aria-label={t('library.config.prompt.variables_title')}
        className="cursor-help text-muted-foreground/50 hover:text-foreground"
      />
    </Tooltip>
  )
}
