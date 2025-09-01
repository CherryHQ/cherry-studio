import { Button, Tooltip } from 'antd'
import { memo } from 'react'

interface ImageToolButtonProps {
  tooltip: string
  icon: React.ReactNode
  onClick: () => void
}

const ImageToolButton = ({ tooltip, icon, onClick }: ImageToolButtonProps) => {
  return (
    <Tooltip title={tooltip} mouseEnterDelay={0.5} mouseLeaveDelay={0}>
      <Button shape="circle" icon={icon} onClick={onClick} role="button" aria-label={tooltip} />
    </Tooltip>
  )
}

export default memo(ImageToolButton)
