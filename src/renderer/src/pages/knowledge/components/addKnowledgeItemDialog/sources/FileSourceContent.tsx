import { formatFileSize } from '@renderer/utils/file'
import { FileText, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import DropzoneCard from '../primitives/DropzoneCard'
import SelectionListItem from '../primitives/SelectionListItem'
import type { DropzoneOnDrop } from '../types'

interface FileSourceContentProps {
  files: File[]
  onDrop: DropzoneOnDrop
  onRemove: (fileIndex: number) => void
}

const FileSourceContent = ({ files, onDrop, onRemove }: FileSourceContentProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <DropzoneCard
        icon={Upload}
        onDrop={onDrop}
        title={t('knowledge.data_source.add_dialog.placeholder.title')}
        description={t('knowledge.data_source.add_dialog.placeholder.supported_formats')}
      />

      {files.length > 0 ? (
        <div data-testid="knowledge-source-file-list" className="max-h-52 overflow-y-auto">
          <div role="list" className="space-y-1.5 pr-1">
            {files.map((file, index) => (
              <SelectionListItem
                key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                icon={FileText}
                iconClassName="size-2.5 shrink-0 text-blue-500"
                name={file.name}
                meta={formatFileSize(file.size)}
                onRemove={() => onRemove(index)}
                removeLabel={t('common.delete')}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default FileSourceContent
