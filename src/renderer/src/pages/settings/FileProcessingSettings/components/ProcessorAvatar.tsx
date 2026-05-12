import { cn } from '@renderer/utils/style'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'

import { getProcessorLogo } from '../utils/fileProcessingMeta'

type ProcessorAvatarProps = {
  processorId: FileProcessorId
  size?: 'sm' | 'lg'
}

export function ProcessorAvatar({ processorId, size = 'sm' }: ProcessorAvatarProps) {
  const Logo = getProcessorLogo(processorId)
  const isLarge = size === 'lg'

  return (
    <Logo.Avatar
      size={isLarge ? 36 : 16}
      shape="rounded"
      className={cn(isLarge ? 'h-9 w-9 rounded-xl' : 'h-4 w-4 rounded')}
    />
  )
}
