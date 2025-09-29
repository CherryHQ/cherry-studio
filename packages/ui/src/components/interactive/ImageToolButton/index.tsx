// Original path: src/renderer/src/components/Preview/ImageToolButton.tsx
import { Button } from '@cherrystudio/ui'
import { memo } from 'react'

import Tooltip from '../../base/Tooltip'

interface ImageToolButtonProps {
  tooltip: string
  icon: React.ReactNode
  onPress: () => void
}

const ImageToolButton = ({ tooltip, icon, onPress }: ImageToolButtonProps) => {
  return (
    <Tooltip placement="top" title={tooltip}>
      <Button radius="full" isIconOnly onPress={onPress} aria-label={tooltip}>
        {icon}
      </Button>
    </Tooltip>
  )
}

export default memo(ImageToolButton)
