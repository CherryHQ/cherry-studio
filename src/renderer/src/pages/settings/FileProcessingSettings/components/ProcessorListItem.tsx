import { Badge } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { FileProcessorMerged } from '@renderer/hooks/useFileProcessors'
import { useNavigate } from '@tanstack/react-router'
import { FileText, Image } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface ProcessorListItemProps {
  processor: FileProcessorMerged
  isActive: boolean
  isDefault: boolean
  isDocument: boolean
}

const ProcessorListItem: FC<ProcessorListItemProps> = ({ processor, isActive, isDefault, isDocument }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const handleClick = () => {
    navigate({
      to: '/settings/file-processing/processor/$processorId',
      params: { processorId: processor.id }
    })
  }

  const renderTag = () => {
    if (isDefault) {
      return (
        <Badge className="rounded-3xs border border-primary/20 bg-primary/10 text-primary">{t('common.default')}</Badge>
      )
    }

    if (processor.type === 'builtin') {
      return (
        <Badge className="rounded-3xs border border-zinc-300/20 bg-zinc-300/10 text-zinc-300">
          {t('settings.file_processing.builtin')}
        </Badge>
      )
    }

    return null
  }

  return (
    <div
      className={cn(
        'flex cursor-pointer flex-row items-center gap-2 rounded-3xs p-2 hover:bg-ghost-hover',
        isActive && 'bg-ghost-hover'
      )}
      onClick={handleClick}>
      {isDocument ? <FileText size={18} /> : <Image size={18} />}
      <span className="flex-1">{t(`processor.${processor.id}.name`)}</span>
      {renderTag()}
    </div>
  )
}

export default ProcessorListItem
