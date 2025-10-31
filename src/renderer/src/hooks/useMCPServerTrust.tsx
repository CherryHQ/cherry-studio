import ProtocolInstallWarningContent from '@renderer/pages/settings/MCPSettings/ProtocolInstallWarning'
import {
  ensureServerTrusted as ensureServerTrustedCore,
  getCommandPreview
} from '@renderer/pages/settings/MCPSettings/utils'
import { MCPServer } from '@renderer/types'
import { modalConfirm } from '@renderer/utils'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { useMCPServers } from './useMCPServers'

/**
 * Hook for handling MCP server trust verification
 * Binds UI (modal dialog) to the core trust verification logic
 */
export const useMCPServerTrust = () => {
  const { updateMCPServer } = useMCPServers()
  const { t } = useTranslation()

  /**
   * Request user confirmation to trust a server
   * Shows a warning modal with server command preview
   */
  const requestConfirm = useCallback(
    async (server: MCPServer): Promise<boolean> => {
      const commandPreview = getCommandPreview(server)
      return modalConfirm({
        title: t('settings.mcp.protocolInstallWarning.title'),
        content: (
          <ProtocolInstallWarningContent
            message={t('settings.mcp.protocolInstallWarning.message')}
            commandLabel={t('settings.mcp.protocolInstallWarning.command')}
            commandPreview={commandPreview}
          />
        ),
        okText: t('settings.mcp.protocolInstallWarning.run'),
        cancelText: t('common.cancel'),
        okButtonProps: { danger: true }
      })
    },
    [t]
  )

  /**
   * Ensures a server is trusted before proceeding
   * Combines core logic with UI confirmation
   */
  const ensureServerTrusted = useCallback(
    async (server: MCPServer): Promise<MCPServer | null> => {
      return ensureServerTrustedCore(server, requestConfirm, updateMCPServer)
    },
    [requestConfirm, updateMCPServer]
  )

  return { ensureServerTrusted }
}
