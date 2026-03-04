import type { ToolQuickPanelApi } from '@renderer/pages/home/Inputbar/types'
import type { FC } from 'react'
import React from 'react'

interface Props {
  assistantId: string
  quickPanel: ToolQuickPanelApi
  setInputValue: React.Dispatch<React.SetStateAction<string>>
  resizeTextArea: () => void
}

const MCPToolsButton: FC<Props> = (_props) => {
  return null
}

export default React.memo(MCPToolsButton)
