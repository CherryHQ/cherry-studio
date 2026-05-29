import { cn } from '@renderer/utils/style'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'

import { getProcessorLogo } from '../utils/fileProcessingMeta'

type ProcessorAvatarSize = 'sm' | 'md' | 'lg'

const SIZE_TO_PX: Record<ProcessorAvatarSize, number> = {
  sm: 16,
  md: 22,
  lg: 36
}

type ProcessorAvatarProps = {
  processorId: FileProcessorId
  size?: ProcessorAvatarSize
  className?: string
}

export function ProcessorAvatar({ processorId, size = 'sm', className }: ProcessorAvatarProps) {
  const Logo = getProcessorLogo(processorId)

  return <Logo.Avatar size={SIZE_TO_PX[size]} shape="rounded" className={cn('rounded', className)} />
}
