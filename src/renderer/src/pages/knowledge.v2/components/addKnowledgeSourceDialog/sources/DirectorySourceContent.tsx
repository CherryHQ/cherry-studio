import { formatFileSize } from '@renderer/utils/file'
import { Folder } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import DropzoneCard from '../primitives/DropzoneCard'
import SelectionListItem from '../primitives/SelectionListItem'
import type { DirectoryItem, DropzoneOnDrop } from '../types'

interface DirectorySourceContentProps {
  directories: DirectoryItem[]
  onDrop: DropzoneOnDrop
  onRemove: (directoryName: string) => void
}

const DirectorySourceContent = ({ directories, onDrop, onRemove }: DirectorySourceContentProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <DropzoneCard
        icon={Folder}
        onDrop={onDrop}
        webkitdirectory=""
        title={t('knowledge_v2.data_source.add_dialog.directory.title')}
        description={t('knowledge_v2.data_source.add_dialog.directory.description')}
      />

      {directories.length > 0 ? (
        <div data-testid="knowledge-source-directory-list" className="max-h-52 overflow-y-auto">
          <div role="list" className="space-y-1.5 pr-1">
            {directories.map((directory) => (
              <SelectionListItem
                key={directory.name}
                icon={Folder}
                iconClassName="size-2.5 shrink-0 text-amber-500"
                name={directory.name}
                meta={`${t('knowledge_v2.meta.documents_count', { count: directory.fileCount })} · ${formatFileSize(directory.totalSize)}`}
                onRemove={() => onRemove(directory.name)}
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
