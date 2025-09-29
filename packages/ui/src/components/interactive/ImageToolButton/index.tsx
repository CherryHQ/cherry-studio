// Original path: src/renderer/src/components/Preview/ImageToolButton.tsx
import { Button } from '@cherrystudio/ui'
import { Tooltip } from 'antd'
import { memo } from 'react'

interface ImageToolButtonProps {
  tooltip: string
  icon: React.ReactNode
  onPress: () => void
}

const ImageToolButton = ({ tooltip, icon, onPress }: ImageToolButtonProps) => {
  return (
    <Tooltip title={tooltip} mouseEnterDelay={0.5} mouseLeaveDelay={0}>
      <Button radius="full" isIconOnly onPress={onPress} aria-label={tooltip}>
        {icon}
      </Button>
    </Tooltip>
  )
}

export default memo(ImageToolButton)
