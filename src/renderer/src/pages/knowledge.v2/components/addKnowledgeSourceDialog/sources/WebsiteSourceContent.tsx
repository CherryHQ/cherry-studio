import { Input } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

const WebsiteSourceContent = () => {
  const { t } = useTranslation()

  return (
    <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-0.75">
      <div>
        <p className="mb-1.5 text-[10px] text-muted-foreground/40 leading-4">
          {t('knowledge_v2.data_source.add_dialog.website.description')}
        </p>
        <Input
          id="knowledge-source-website-input"
          placeholder={t('knowledge_v2.data_source.add_dialog.website.placeholder')}
          className="w-full rounded-md border border-border/40 bg-transparent px-2.5 py-1.25 text-[11px] text-foreground outline-none transition-all focus:border-primary/40 focus:ring-1 focus:ring-primary/15"
        />

        <div className="space-y-2 rounded-md border border-border/20 bg-muted/20 p-2.5">
          <p className="text-[9px] text-muted-foreground/40 leading-4">
            {t('knowledge_v2.data_source.add_dialog.website.settings_title')}
          </p>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                htmlFor="knowledge-source-website-depth"
                className="mb-0.5 block text-[9px] text-muted-foreground/35 leading-4">
                {t('knowledge_v2.data_source.add_dialog.website.depth_label')}
              </label>
              <Input
                id="knowledge-source-website-depth"
                inputMode="numeric"
                readOnly
                value="2"
                className="w-full rounded border border-border/30 bg-transparent px-2 py-1 text-[11px] text-foreground outline-none transition-all focus:border-primary/40"
              />
            </div>

            <div>
              <label
                htmlFor="knowledge-source-website-max-pages"
                className="mb-0.5 block text-[9px] text-muted-foreground/35 leading-4">
                {t('knowledge_v2.data_source.add_dialog.website.max_pages_label')}
              </label>
              <Input
                id="knowledge-source-website-max-pages"
                inputMode="numeric"
                readOnly
                value="50"
                className="w-full rounded border border-border/30 bg-transparent px-2 py-1 text-[11px] text-foreground outline-none transition-all focus:border-primary/40"
              />
            </div>
          </div>

          <p className="text-[8px] text-muted-foreground/25 leading-4">
            {t('knowledge_v2.data_source.add_dialog.website.help')}
          </p>
        </div>
      </div>
    </div>
  )
}

export default WebsiteSourceContent
