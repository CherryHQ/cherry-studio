import { CodeOutlined, PlusOutlined } from '@ant-design/icons'
import { QuickPanelListItem, useQuickPanel } from '@renderer/components/QuickPanel'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { MCPServer } from '@renderer/types'
import { Tooltip } from 'antd'
import { FC, useCallback, useImperativeHandle, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

export interface MCPToolsButtonRef {
  openQuickPanel: () => void
  openPromptList: () => void
}

interface Props {
  ref?: React.RefObject<MCPToolsButtonRef | null>
  enabledMCPs: MCPServer[]
  setInputValue: React.Dispatch<React.SetStateAction<string>>
  resizeTextArea: () => void
  toggelEnableMCP: (server: MCPServer) => void
  ToolbarButton: any
}

const MCPToolsButton: FC<Props> = ({
  ref,
  setInputValue,
  resizeTextArea,
  enabledMCPs,
  toggelEnableMCP,
  ToolbarButton
}) => {
  const { activedMcpServers } = useMCPServers()
  const { t } = useTranslation()
  const quickPanel = useQuickPanel()
  const navigate = useNavigate()

  const availableMCPs = activedMcpServers.filter((server) => enabledMCPs.some((s) => s.id === server.id))

  const buttonEnabled = availableMCPs.length > 0

  const menuItems = useMemo(() => {
    const newList: QuickPanelListItem[] = activedMcpServers.map((server) => ({
      label: server.name,
      description: server.description || server.baseUrl,
      icon: <CodeOutlined />,
      action: () => toggelEnableMCP(server),
      isSelected: enabledMCPs.some((s) => s.id === server.id)
    }))

    newList.push({
      label: t('settings.mcp.addServer') + '...',
      icon: <PlusOutlined />,
      action: () => navigate('/settings/mcp')
    })
    return newList
  }, [activedMcpServers, t, enabledMCPs, toggelEnableMCP, navigate])

  const openQuickPanel = useCallback(() => {
    quickPanel.open({
      title: t('settings.mcp.title'),
      list: menuItems,
      symbol: 'mcp',
      multiple: true,
      afterAction({ item }) {
        item.isSelected = !item.isSelected
      }
    })
  }, [menuItems, quickPanel, t])

  const handlePromptSelect = useCallback(
    (prompt: string) => {
      setTimeout(() => {
        setInputValue((prev) => {
          const textArea = document.querySelector('.inputbar textarea') as HTMLTextAreaElement
          const cursorPosition = textArea.selectionStart
          const selectionStart = cursorPosition
          const selectionEndPosition = cursorPosition + prompt.length
          const newText = prev.slice(0, cursorPosition) + prompt + prev.slice(cursorPosition)

          setTimeout(() => {
            textArea.focus()
            textArea.setSelectionRange(selectionStart, selectionEndPosition)
            resizeTextArea()
          }, 10)
          return newText
        })
      }, 10)
    },
    [setInputValue, resizeTextArea]
  )

  const promptList = useMemo(() => {
    return Array.from({ length: 10 }).map((_, index) => ({
      label: `Prompt ${index + 1}`,
      description: `This is a sample prompt description ${index + 1}`,
      icon: <CodeOutlined />,
      action: () => handlePromptSelect(`This is a sample prompt description ${index + 1}`)
    }))
  }, [handlePromptSelect])

  const openPromptList = useCallback(() => {
    quickPanel.open({
      title: t('settings.mcp.title'),
      list: promptList,
      symbol: 'mcp-prompt',
      multiple: true
    })
  }, [promptList, quickPanel, t])

  const handleOpenQuickPanel = useCallback(() => {
    if (quickPanel.isVisible && quickPanel.symbol === 'mcp') {
      quickPanel.close()
    } else {
      openQuickPanel()
    }
  }, [openQuickPanel, quickPanel])

  useImperativeHandle(ref, () => ({
    openQuickPanel,
    openPromptList
  }))

  if (activedMcpServers.length === 0) {
    return null
  }

  return (
    <Tooltip placement="top" title={t('settings.mcp.title')} arrow>
      <ToolbarButton type="text" onClick={handleOpenQuickPanel}>
        <CodeOutlined style={{ color: buttonEnabled ? 'var(--color-primary)' : 'var(--color-icon)' }} />
      </ToolbarButton>
    </Tooltip>
  )
}

export default MCPToolsButton
