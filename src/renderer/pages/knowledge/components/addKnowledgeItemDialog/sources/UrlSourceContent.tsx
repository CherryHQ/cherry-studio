import { useTranslation } from 'react-i18next'

import { Input } from '@cherrystudio/ui'

interface UrlSourceContentProps {
  value: string
  onValueChange: (value: string) => void
}

const UrlSourceContent = ({ value, onValueChange }: UrlSourceContentProps) => {
  const { t } = useTranslation()

  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      <div className="min-w-0">
        <p className="mb-1.5 text-xs leading-4 text-muted-foreground">
          {t('knowledge.data_source.add_dialog.url.description')}
        </p>
        <Input
          id="knowledge-source-url-input"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={t('knowledge.data_source.add_dialog.url.placeholder')}
          className="w-full rounded-md border-border-subtle bg-background px-2.5 py-1.25 text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-0"
        />
        <p className="mt-1 text-xs leading-4 text-muted-foreground">{t('knowledge.data_source.add_dialog.url.help')}</p>
      </div>
    </div>
  )
}

export default UrlSourceContent
