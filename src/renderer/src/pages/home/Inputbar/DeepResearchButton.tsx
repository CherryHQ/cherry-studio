import { Tooltip } from 'antd'
import { Microscope } from 'lucide-react'
import React, { memo, ReactElement } from 'react'

interface Props {
  enabled: boolean
  onEnableDeepResearch: () => void
  ToolbarButton: any
}

const DeepResearchButton: React.FC<Props> = ({ enabled, onEnableDeepResearch, ToolbarButton }): ReactElement => {
  return (
    <Tooltip placement="top" title="Deep Research (Coming Soon)" mouseLeaveDelay={0} arrow>
      <ToolbarButton type="text" onClick={onEnableDeepResearch}>
        <Microscope
          size={18}
          style={{
            color: enabled ? 'var(--color-primary)' : 'var(--color-icon)'
          }}
        />
      </ToolbarButton>
    </Tooltip>
  )
}

export default memo(DeepResearchButton)
