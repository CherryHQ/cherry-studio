import { Input } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

interface UrlSourceContentProps {
  value: string
  onValueChange: (value: string) => void
}

const UrlSourceContent = ({ value, onValueChange }: UrlSourceContentProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-0.75">
      <div>
        <p className="mb-1.5 text-muted-foreground/40 text-xs leading-4">
          {t('knowledge_v2.data_source.add_dialog.url.description')}
        </p>
        <Input
          id="knowledge-source-url-input"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={t('knowledge_v2.data_source.add_dialog.url.placeholder')}
          className="w-full rounded-md border border-border/40 bg-transparent px-2.5 py-1.25 text-foreground text-sm outline-none transition-all focus:border-primary/40 focus:ring-1 focus:ring-primary/15"
        />
        <p className="mt-1 text-muted-foreground/25 text-xs leading-4">
          {t('knowledge_v2.data_source.add_dialog.url.help')}
        </p>
      </div>
    </div>
  )
}

export default UrlSourceContent
