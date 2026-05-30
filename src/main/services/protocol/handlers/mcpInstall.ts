import { application } from '@application'
import { loggerService } from '@logger'
import { nanoid } from '@reduxjs/toolkit'
import type { MCPServer } from '@shared/data/types/mcpServer'
import { IpcChannel } from '@shared/IpcChannel'

const logger = loggerService.withContext('ProtocolService:mcpInstall')

function installMCPServer(server: MCPServer) {
  const mainWindow = application.get('MainWindowService').getMainWindow()
  const now = Date.now()

  const payload: MCPServer = {
    ...server,
    id: server.id ?? nanoid(),
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

function installMCPServers(servers: Record<string, MCPServer>) {
  for (const name in servers) {
    const server = servers[name]
    if (!server.name) {
      server.name = name
    }
    installMCPServer(server)
  }
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
        const stringify = Buffer.from(data, 'base64').toString('utf8')
        logger.debug(`install MCP servers from protocol: ${stringify}`)
        const jsonConfig = JSON.parse(stringify)
        logger.debug(`install MCP servers from protocol: ${JSON.stringify(jsonConfig)}`)

        // support both {mcpServers: [servers]}, [servers] and {server}
        if (jsonConfig.mcpServers) {
          installMCPServers(jsonConfig.mcpServers)
        } else if (Array.isArray(jsonConfig)) {
          for (const server of jsonConfig) {
            installMCPServer(server)
          }
        } else {
          installMCPServer(jsonConfig)
        }
      }

      application.get('MainWindowService').showMainWindow()

      break
    }
    default:
      logger.error(`Unknown MCP protocol URL: ${url}`)
      break
  }
}
