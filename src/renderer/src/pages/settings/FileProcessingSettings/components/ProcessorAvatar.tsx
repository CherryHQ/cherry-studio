import { cn } from '@renderer/utils/style'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'

import { getProcessorLogo } from '../utils/fileProcessingMeta'

type ProcessorAvatarProps = {
  processorId: FileProcessorId
  size?: number
  className?: string
}

export function ProcessorAvatar({ processorId, size = 16, className }: ProcessorAvatarProps) {
  const Logo = getProcessorLogo(processorId)

  return <Logo.Avatar size={size} shape="rounded" className={cn('rounded', className)} />
}
