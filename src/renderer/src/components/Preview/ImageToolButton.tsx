import { Button, Tooltip } from '@cherrystudio/ui'
import { memo } from 'react'

interface ImageToolButtonProps {
  tooltip: string
  icon: React.ReactNode
  onPress: () => void
}

const ImageToolButton = ({ tooltip, icon, onPress }: ImageToolButtonProps) => {
  return (
    <Tooltip content={tooltip} delay={500} closeDelay={0}>
      <Button radius="full" startContent={icon} onPress={onPress} isIconOnly aria-label={tooltip} />
    </Tooltip>
  )
}

export default memo(ImageToolButton)
