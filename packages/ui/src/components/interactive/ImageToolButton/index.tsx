// Original path: src/renderer/src/components/Preview/ImageToolButton.tsx
import { Button } from 'antd'
import { memo } from 'react'

import Tooltip from '../../base/Tooltip'

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
