import { Badge } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import { useNavigate } from '@tanstack/react-router'
import { FileText, Image } from 'lucide-react'
import type { FC, PropsWithChildren } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'

type ProcessorKind = 'document' | 'image'

interface ProcessorListItemContextValue {
  processor: FileProcessorMerged
  isActive: boolean
  isDefault: boolean
  isBuiltin: boolean
  kind: ProcessorKind
}

const ProcessorListItemContext = React.createContext<ProcessorListItemContextValue | null>(null)

const useProcessorListItemContext = () => {
  const context = React.use(ProcessorListItemContext)
  if (!context) {
    throw new Error('ProcessorListItem components must be used within ProcessorListItem.Root')
  }
  return context
}

interface ProcessorListItemRootProps extends PropsWithChildren {
  processor: FileProcessorMerged
  activeId?: string
  defaultId?: string | null
  kind: ProcessorKind
}

const ProcessorListItemRoot: FC<ProcessorListItemRootProps> = ({ processor, activeId, defaultId, kind, children }) => {
  const navigate = useNavigate()
  const isActive = activeId === processor.id
  const isDefault = defaultId === processor.id
  const isBuiltin = processor.type === 'builtin'

  return (
    <ProcessorListItemContext value={{ processor, isActive, isDefault, isBuiltin, kind }}>
      <div
        className={cn(
          'flex cursor-pointer flex-row items-center gap-2 rounded-3xs p-2 hover:bg-ghost-hover',
          isActive && 'bg-ghost-hover'
        )}
        onClick={() =>
          navigate({
            to: '/settings/file-processing/processor/$processorId',
            params: { processorId: processor.id }
          })
        }>
        {children}
      </div>
    </ProcessorListItemContext>
  )
}

const ProcessorListItemIcon: FC = () => {
  const { kind } = useProcessorListItemContext()
  return kind === 'document' ? <FileText size={18} /> : <Image size={18} />
}

const ProcessorListItemLabel: FC = () => {
  const { t } = useTranslation()
  const { processor } = useProcessorListItemContext()
  return <span className="flex-1">{t(`settings.file_processing.processor.${processor.id}.name`)}</span>
}

const ProcessorListItemBadge: FC = () => {
  const { t } = useTranslation()
  const { isDefault, isBuiltin } = useProcessorListItemContext()

  if (isDefault) {
    return (
      <Badge className="rounded-3xs border border-primary/20 bg-primary/10 text-primary">{t('common.default')}</Badge>
    )
  }

  if (isBuiltin) {
    return (
      <Badge className="rounded-3xs border border-zinc-300/20 bg-zinc-300/10 text-zinc-300">
        {t('settings.file_processing.builtin')}
      </Badge>
    )
  }

  return null
}

const ProcessorListItem = {
  Root: ProcessorListItemRoot,
  Icon: ProcessorListItemIcon,
  Label: ProcessorListItemLabel,
  Badge: ProcessorListItemBadge
}

export default ProcessorListItem
