import { memo } from 'react'

import { Button, Tooltip } from '@cherrystudio/ui'

interface ImageToolButtonProps {
  tooltip: string
  icon: React.ReactNode
  onClick: () => void
}

const ImageToolButton = ({ tooltip, icon, onClick }: ImageToolButtonProps) => {
  return (
    <Tooltip content={tooltip} delay={500}>
      <Button className="rounded-full" onClick={onClick} size="icon" aria-label={tooltip}>
        {icon}
      </Button>
    </Tooltip>
  )
}

export default memo(ImageToolButton)
