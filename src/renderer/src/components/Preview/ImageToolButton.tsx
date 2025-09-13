import { Tooltip } from '@heroui/react'
import { Button } from 'antd'
import { memo } from 'react'

interface ImageToolButtonProps {
  tooltip: string
  icon: React.ReactNode
  onClick: () => void
}

const ImageToolButton = ({ tooltip, icon, onClick }: ImageToolButtonProps) => {
  return (
    <Tooltip content={tooltip} delay={500} showArrow={true}>
      <Button shape="circle" icon={icon} onClick={onClick} role="button" aria-label={tooltip} />
    </Tooltip>
  )
}

export default memo(ImageToolButton)
