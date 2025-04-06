import { CodeOutlined, PlusOutlined } from '@ant-design/icons'
import { QuickPanelListItem, useQuickPanel } from '@renderer/components/QuickPanel'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { initializeMCPServers } from '@renderer/store/mcp'
import { MCPServer } from '@renderer/types'
import { Tooltip } from 'antd'
import { FC, useCallback, useEffect, useImperativeHandle, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useDispatch } from 'react-redux'
import { useNavigate } from 'react-router'

export interface MCPToolsButtonRef {
  openQuickPanel: () => void
}

interface Props {
  ref?: React.RefObject<MCPToolsButtonRef | null>
  enabledMCPs: MCPServer[]
  toggelEnableMCP: (server: MCPServer) => void
  ToolbarButton: any
}

const MCPToolsButton: FC<Props> = ({ ref, enabledMCPs, toggelEnableMCP, ToolbarButton }) => {
  const { activedMcpServers, mcpServers } = useMCPServers()
  const { t } = useTranslation()
  const quickPanel = useQuickPanel()
  const navigate = useNavigate()
  const dispatch = useDispatch()

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

  useEffect(() => {
    initializeMCPServers(mcpServers, dispatch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const handleOpenQuickPanel = useCallback(() => {
    if (quickPanel.isVisible && quickPanel.symbol === 'mcp') {
      quickPanel.close()
    } else {
      openQuickPanel()
    }
  }, [openQuickPanel, quickPanel])

  useImperativeHandle(ref, () => ({
    openQuickPanel
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
