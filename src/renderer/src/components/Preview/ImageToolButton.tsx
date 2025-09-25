import { Tooltip } from '@cherrystudio/ui'
import { Button } from 'antd'
import { memo } from 'react'

interface ImageToolButtonProps {
  tooltip: string
  icon: React.ReactNode
  onClick: () => void
}

const ImageToolButton = ({ tooltip, icon, onClick }: ImageToolButtonProps) => {
  return (
    <Tooltip placement="top" title={tooltip}>
      <Button shape="circle" icon={icon} onClick={onClick} role="button" aria-label={tooltip} />
    </Tooltip>
  )
}

export default memo(ImageToolButton)
