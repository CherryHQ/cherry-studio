import { loggerService } from '@logger'
import { nanoid } from '@reduxjs/toolkit'
import { IpcChannel } from '@shared/IpcChannel'
import { type MCPServer, type McpServerConfig, safeValidateMcpConfig, safeValidateMcpServerConfig } from '@types'

import { windowService } from '../WindowService'

const logger = loggerService.withContext('URLSchema:handleMcpProtocolUrl')

function installMCPServer(server: McpServerConfig) {
  const mainWindow = windowService.getMainWindow()
  const now = Date.now()

  const payload: MCPServer = {
    ...server,
    id: server.id ?? nanoid(),
    name: server.name ?? `Protocol MCP Server ${nanoid()}`,
    installSource: 'protocol',
    isTrusted: false,
    isActive: false,
    trustedAt: undefined,
    installedAt: server.installedAt ?? now
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IpcChannel.Mcp_AddServer, payload)
  }
}

function parseProtocolServers(data: string): McpServerConfig[] {
  let payload: unknown

  try {
    const normalized = data.replaceAll(' ', '+').replaceAll('-', '+').replaceAll('_', '/')
    const decoded = Buffer.from(normalized, 'base64').toString('utf8')
    logger.debug(`install MCP servers from urlschema: ${decoded}`)
    payload = JSON.parse(decoded)
  } catch (error) {
    logger.error('Failed to parse MCP protocol payload:', error as Error)
    return []
  }

  const configResult = safeValidateMcpConfig(payload)
  if (configResult.success) {
    return Object.entries(configResult.data.mcpServers).map(([name, server]) => ({
      ...server,
      name: server.name ?? name
    }))
  }

  if (
    payload &&
    typeof payload === 'object' &&
    'mcpServers' in payload &&
    payload.mcpServers &&
    typeof payload.mcpServers === 'object' &&
    !Array.isArray(payload.mcpServers)
  ) {
    return Object.entries(payload.mcpServers as Record<string, unknown>).flatMap(([name, server]) => {
      const result = safeValidateMcpServerConfig(server)
      if (!result.success) {
        logger.warn('Skipping invalid MCP server from protocol map payload', {
          name,
          error: result.error.message
        })
        return []
      }

      return [
        {
          ...result.data,
          name: result.data.name ?? name
        }
      ]
    })
  }

  if (Array.isArray(payload)) {
    return payload.flatMap((server, index) => {
      const result = safeValidateMcpServerConfig(server)
      if (!result.success) {
        logger.warn('Skipping invalid MCP server from protocol array payload', {
          index,
          error: result.error.message
        })
        return []
      }

      return [result.data]
    })
  }

  const singleResult = safeValidateMcpServerConfig(payload)
  if (singleResult.success) {
    return [singleResult.data]
  }

  logger.warn('Invalid MCP protocol payload', {
    error: configResult.error.message,
    singleServerError: singleResult.error.message
  })
  return []
}

export function handleMcpProtocolUrl(url: URL) {
  const params = new URLSearchParams(url.search)
  switch (url.pathname) {
    case '/install': {
      // jsonConfig example:
      // {
      //   "mcpServers": {
      //     "everything": {
      //       "command": "npx",
      //       "args": [
      //         "-y",
      //         "@modelcontextprotocol/server-everything"
      //       ]
      //     }
      //   }
      // }
      // cherrystudio://mcp/install?servers={base64Encode(JSON.stringify(jsonConfig))}

      const data = params.get('servers')

      if (data) {
        const servers = parseProtocolServers(data)
        logger.debug(`install MCP servers from urlschema: ${JSON.stringify(servers)}`)

        for (const server of servers) {
          installMCPServer(server)
        }
      }

      windowService.getMainWindow()?.show()

      break
    }
    default:
      logger.error(`Unknown MCP protocol URL: ${url}`)
      break
  }
}
