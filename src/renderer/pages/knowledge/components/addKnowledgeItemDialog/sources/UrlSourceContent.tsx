import { useTranslation } from 'react-i18next'

import { Textarea } from '@cherrystudio/ui'

import type { KnowledgeUrlEntry } from '../../../utils/parseKnowledgeUrls'

interface UrlSourceContentProps {
  value: string
  onValueChange: (value: string) => void
  urlErrors: KnowledgeUrlEntry[]
  disabled: boolean
}

const UrlSourceContent = ({ value, onValueChange, urlErrors, disabled }: UrlSourceContentProps) => {
  const { t } = useTranslation()

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <label htmlFor="knowledge-source-url-input" className="mb-1.5 block text-xs leading-4 text-muted-foreground">
        {t('knowledge.data_source.add_dialog.url.description')}
      </label>
      <Textarea.Input
        id="knowledge-source-url-input"
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        hasError={urlErrors.length > 0}
        aria-describedby={
          urlErrors.length > 0 ? 'knowledge-source-url-help knowledge-source-url-errors' : 'knowledge-source-url-help'
        }
        placeholder={t('knowledge.data_source.add_dialog.url.placeholder')}
        className="h-32 max-h-48 field-sizing-fixed overflow-y-auto break-all"
      />
      <p id="knowledge-source-url-help" className="mt-1 text-xs leading-4 text-muted-foreground">
        {t('knowledge.data_source.add_dialog.url.help')}
      </p>
      {urlErrors.length > 0 ? (
        <ul
          id="knowledge-source-url-errors"
          aria-live="polite"
          className="mt-2 max-h-32 overflow-y-auto text-xs leading-4 text-error-subtle-foreground">
          {urlErrors.slice(0, 100).map((entry) => (
            <li key={entry.index} className="break-all">
              {t('knowledge.data_source.add_dialog.url.invalid_entry', { ...entry })}
            </li>
          ))}
          {urlErrors.length > 100 ? (
            <li>{t('knowledge.data_source.add_dialog.url.more_errors', { count: urlErrors.length - 100 })}</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}

export default UrlSourceContent
