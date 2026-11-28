import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import type { UpdateMcpServerDto } from '@shared/data/api/schemas/mcpServers'
import type { McpServer } from '@shared/data/types/mcpServer'

import ProtocolInstallWarningContent from './ProtocolInstallWarning'
import { ensureServerTrusted as ensureServerTrustedCore } from './utils'

const logger = loggerService.withContext('useMcpServerTrust')

/**
 * Hook for handling MCP server trust verification
 * Binds UI (modal dialog) to the core trust verification logic
 *
 * @param updateServer - callback to persist trust changes for a server
 */
export const useMcpServerTrust = (updateServer: (body: UpdateMcpServerDto) => void) => {
  const { t } = useTranslation()

  /**
   * Request user confirmation to trust a server
   * Shows a warning modal with server command preview
   */
  const requestConfirm = useCallback(
    async (server: McpServer): Promise<boolean> => {
      let previewServer = server
      if (server.dxtPath) {
        try {
          const resolved = await ipcApi.request('mcp.package.get_resolved_config', { serverId: server.id })
          if (resolved) {
            previewServer = {
              ...server,
              command: resolved.command,
              args: resolved.args,
              env: resolved.env
            }
          }
        } catch (error) {
          logger.warn('Failed to resolve package launch config for trust preview', error as Error)
        }
      }

      const isProtocolInstall = server.installSource === 'protocol'
      return popup.confirm({
        centered: true,
        title: t(
          isProtocolInstall ? 'settings.mcp.protocolInstallWarning.title' : 'settings.mcp.importTrustWarning.title'
        ),
        content: (
          <ProtocolInstallWarningContent
            message={t(
              isProtocolInstall
                ? 'settings.mcp.protocolInstallWarning.message'
                : 'settings.mcp.importTrustWarning.message'
            )}
            server={previewServer}
          />
        ),
        okText: t(
          isProtocolInstall ? 'settings.mcp.protocolInstallWarning.run' : 'settings.mcp.importTrustWarning.confirm'
        ),
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
    async (server: McpServer): Promise<McpServer | null> => {
      return ensureServerTrustedCore(server, requestConfirm, updateServer)
    },
    [requestConfirm, updateServer]
  )

  return { ensureServerTrusted }
}
