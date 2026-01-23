// Original path: src/renderer/src/components/Preview/ImageToolButton.tsx
import { memo } from 'react'

import { Button } from '../../primitives/button'
import { Tooltip } from '../../primitives/tooltip'

interface ImageToolButtonProps {
  tooltip: string
  icon: React.ReactNode
  onPress: () => void
}

const ImageToolButton = ({ tooltip, icon, onPress }: ImageToolButtonProps) => {
  return (
    <Tooltip content={tooltip} delay={500} closeDelay={0}>
      <Button size="icon" className="rounded-full" onClick={onPress} aria-label={tooltip}>
        {icon}
      </Button>
    </Tooltip>
  )
}

export default memo(ImageToolButton)
