import { formatFileSize } from '@renderer/utils/file'
import { FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { KNOWLEDGE_SUPPORTED_FILE_TYPES } from '../constants'
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
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3">
      <div data-testid="knowledge-source-file-list" className="min-h-0 flex-1 overflow-y-auto">
        {files.length > 0 ? (
          <div role="list" className="space-y-1.5 pr-1">
            {files.map((file, index) => (
              <SelectionListItem
                key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                icon={FileText}
                iconClassName="size-3.5 shrink-0 text-blue-500"
                name={file.name}
                meta={formatFileSize(file.size)}
                onRemove={() => onRemove(index)}
                removeLabel={t('common.delete')}
              />
            ))}
          </div>
        ) : null}
      </div>

      <DropzoneCard
        onDrop={onDrop}
        title={t('knowledge.drag_file')}
        description={t('knowledge.file_hint', { file_types: KNOWLEDGE_SUPPORTED_FILE_TYPES })}
      />
    </div>
  )
}

export default FileSourceContent
