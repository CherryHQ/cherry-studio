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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <button
        type="button"
        data-testid="knowledge-source-directory-select"
        onClick={() => void onSelectDirectory()}
        className="min-h-24 min-w-0 shrink-0 whitespace-normal rounded-md border border-border-muted border-dashed px-4 py-4 text-center text-foreground-muted shadow-none transition-colors hover:border-border-hover hover:bg-muted/30 hover:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        <div className="flex min-w-0 flex-col items-center justify-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-full bg-accent text-foreground-muted">
            <Folder className="size-4" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-foreground text-sm leading-5">{t('knowledge.data_source.add_dialog.directory.title')}</p>
            <p className="text-xs leading-5">{t('knowledge.data_source.add_dialog.directory.description')}</p>
          </div>
        </div>
      </button>

      {directories.length > 0 ? (
        <div data-testid="knowledge-source-directory-list" className="min-h-0 flex-1 overflow-y-auto">
          <div role="list" className="space-y-1.5 pr-1">
            {directories.map((directory) => (
              <SelectionListItem
                key={directory.path}
                icon={Folder}
                iconClassName="size-3.5 shrink-0 text-amber-500"
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
