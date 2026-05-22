// Original path: src/renderer/src/components/Preview/ImageToolButton.tsx
import { Button } from '@cherrystudio/ui/components/primitives/button'
import { Tooltip } from '@cherrystudio/ui/components/primitives/tooltip'
import { memo } from 'react'

interface ImageToolButtonProps {
  tooltip: string
  icon: React.ReactNode
  onPress: () => void
}

const ImageToolButton = ({ tooltip, icon, onPress }: ImageToolButtonProps) => {
  return (
    <Tooltip content={tooltip} delay={500}>
      <Button size="icon" className="rounded-full" onClick={onPress} aria-label={tooltip}>
        {icon}
      </Button>
    </Tooltip>
  )
}

export default memo(ImageToolButton)
