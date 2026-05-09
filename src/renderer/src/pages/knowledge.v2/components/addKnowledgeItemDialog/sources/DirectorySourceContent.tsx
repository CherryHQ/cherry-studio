import { Folder } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import SelectionListItem from '../primitives/SelectionListItem'
import type { DirectoryItem } from '../types'

interface DirectorySourceContentProps {
  directories: DirectoryItem[]
  onRemove: (directoryPath: string) => void
  onSelectDirectory: () => void | Promise<void>
}

const DirectorySourceContent = ({ directories, onRemove, onSelectDirectory }: DirectorySourceContentProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <button
        type="button"
        data-testid="knowledge-source-directory-select"
        onClick={() => void onSelectDirectory()}
        className="min-h-29.5 shrink-0 rounded-lg border-2 border-border/30 border-dashed bg-muted/[0.06] p-5 text-center text-foreground shadow-none transition-colors hover:border-border/30 hover:bg-muted/[0.06] hover:text-foreground">
        <div className="flex flex-col items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-full bg-muted/40 text-muted-foreground/55">
            <Folder className="size-4" />
          </div>
          <div className="space-y-1">
            <p className="text-sm leading-4">{t('knowledge_v2.data_source.add_dialog.directory.title')}</p>
            <p className="text-muted-foreground/60 text-xs leading-4">
              {t('knowledge_v2.data_source.add_dialog.directory.description')}
            </p>
          </div>
        </div>
      </button>

      {directories.length > 0 ? (
        <div data-testid="knowledge-source-directory-list" className="max-h-52 overflow-y-auto">
          <div role="list" className="space-y-1.5 pr-1">
            {directories.map((directory) => (
              <SelectionListItem
                key={directory.path}
                icon={Folder}
                iconClassName="size-2.5 shrink-0 text-amber-500"
                name={directory.name}
                meta={directory.path}
                onRemove={() => onRemove(directory.path)}
                removeLabel={t('common.delete')}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default DirectorySourceContent
