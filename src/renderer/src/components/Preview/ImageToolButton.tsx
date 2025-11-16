import { Button, Tooltip } from '@cherrystudio/ui'
import { memo } from 'react'

interface ImageToolButtonProps {
  tooltip: string
  icon: React.ReactNode
  onClick: () => void
}

const ImageToolButton = ({ tooltip, icon, onClick }: ImageToolButtonProps) => {
  return (
    <Tooltip content={tooltip} delay={500} closeDelay={0}>
      <Button className="rounded-full" onClick={onClick} size="icon" aria-label={tooltip}>
        {icon}
      </Button>
    </Tooltip>
  )
}

export default memo(ImageToolButton)
