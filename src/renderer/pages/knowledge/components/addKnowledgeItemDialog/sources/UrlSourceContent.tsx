import { useTranslation } from 'react-i18next'

import { Checkbox, Input, Textarea } from '@cherrystudio/ui'

import type { KnowledgeUrlEntry } from '../../../utils/parseKnowledgeUrls'

interface UrlSourceContentProps {
  value: string
  crawl: boolean
  onCrawlChange: (crawl: boolean) => void
  name: string
  onNameChange: (name: string) => void
  onValueChange: (value: string) => void
  urlValid: KnowledgeUrlEntry[]
  urlErrors: KnowledgeUrlEntry[]
  disabled: boolean
}

const UrlSourceContent = ({
  value,
  onValueChange,
  name,
  crawl,
  onCrawlChange,
  onNameChange,
  urlValid,
  urlErrors,
  disabled
}: UrlSourceContentProps) => {
  const { t } = useTranslation()
  const showValidPreview = urlValid.length > 0 && urlValid.length + urlErrors.length > 1

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
          'knowledge-source-url-help' +
          (showValidPreview ? ' knowledge-source-url-valid' : '') +
          (urlErrors.length > 0 ? ' knowledge-source-url-errors' : '')
        }
        placeholder={t('knowledge.data_source.add_dialog.url.placeholder')}
        className="field-sizing-fixed h-32 max-h-48 overflow-y-auto break-all"
      />
      <p id="knowledge-source-url-help" className="mt-1 text-xs leading-4 text-muted-foreground">
        {t('knowledge.data_source.add_dialog.url.help')}
      </p>
      <label htmlFor="knowledge-source-url-name" className="mt-3 mb-1.5 block text-xs leading-4 text-muted-foreground">
        {t('knowledge.data_source.add_dialog.url.name_label')}
      </label>
      <Input
        id="knowledge-source-url-name"
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
        disabled={disabled}
        placeholder={t('knowledge.data_source.add_dialog.url.name_placeholder')}
        className="w-full"
      />
      <label className="mt-3 flex items-start gap-2 text-sm">
        <Checkbox
          checked={crawl}
          onCheckedChange={(value) => onCrawlChange(value === true)}
          disabled={disabled}
          aria-describedby="knowledge-url-crawl-help"
        />
        <span>{t('knowledge.data_source.add_dialog.url.crawl_label')}</span>
      </label>
      <p id="knowledge-url-crawl-help" className="mt-1 text-xs leading-4 text-muted-foreground">
        {t('knowledge.data_source.add_dialog.url.crawl_help')}
      </p>
      {showValidPreview ? (
        <ul id="knowledge-source-url-valid" className="mt-2 max-h-32 overflow-y-auto text-xs leading-4">
          <li className="break-all">{t('knowledge.data_source.add_dialog.url.valid_preview')}</li>
          {urlValid.slice(0, 100).map((entry) => (
            <li key={entry.index} className="break-all">
              {entry.value}
            </li>
          ))}
          {urlValid.length > 100 ? (
            <li className="break-all">
              {t('knowledge.data_source.add_dialog.url.more_entries', { count: urlValid.length - 100 })}
            </li>
          ) : null}
        </ul>
      ) : null}
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
