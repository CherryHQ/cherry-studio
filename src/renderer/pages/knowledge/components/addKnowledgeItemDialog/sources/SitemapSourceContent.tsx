import { Input } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

interface SitemapSourceContentProps {
  value: string
  onValueChange: (value: string) => void
}

const SitemapSourceContent = ({ value, onValueChange }: SitemapSourceContentProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex-1 overflow-y-auto">
      <div>
        <p className="mb-1.5 text-foreground-muted text-xs leading-4">
          {t('knowledge.data_source.add_dialog.sitemap.description')}
        </p>
        <Input
          id="knowledge-source-sitemap-input"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={t('knowledge.data_source.add_dialog.sitemap.placeholder')}
          className="w-full"
        />
        <p className="mt-1 text-foreground-muted text-xs leading-4">
          {t('knowledge.data_source.add_dialog.sitemap.help')}
        </p>
      </div>
    </div>
  )
}

export default SitemapSourceContent
