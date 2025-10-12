import { loggerService } from '@logger'
import { nanoid } from '@reduxjs/toolkit'
import { IpcChannel } from '@shared/IpcChannel'
import { MCPServer } from '@types'
import { dialog } from 'electron'

import { windowService } from '../WindowService'

const logger = loggerService.withContext('URLSchema:handleMcpProtocolUrl')

// Allowed safe commands whitelist
const ALLOWED_COMMANDS = ['npx', 'uvx', 'uv', 'bun', 'node', 'python', 'python3']

function isCommandSafe(command?: string): boolean {
  if (!command) return true // baseUrl-based servers don't have command
  return ALLOWED_COMMANDS.includes(command)
}

function installMCPServer(server: MCPServer) {
  const mainWindow = windowService.getMainWindow()

  if (!server.id) {
    server.id = nanoid()
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IpcChannel.Mcp_AddServer, server)
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

export async function handleMcpProtocolUrl(url: URL) {
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
        logger.debug(`install MCP servers from urlschema: ${stringify}`)
        const jsonConfig = JSON.parse(stringify)
        logger.debug(`install MCP servers from urlschema: ${JSON.stringify(jsonConfig)}`)

        // Extract servers to validate
        let servers: MCPServer[] = []
        if (jsonConfig.mcpServers) {
          servers = Object.entries(jsonConfig.mcpServers).map(([name, server]: [string, any]) => ({
            ...server,
            name: server.name || name
          }))
        } else if (Array.isArray(jsonConfig)) {
          servers = jsonConfig
        } else {
          servers = [jsonConfig]
        }

        // Validate command safety
        for (const server of servers) {
          if (server.command && !isCommandSafe(server.command)) {
            logger.warn(`Blocked unsafe command: ${server.command}`)
            const mainWindow = windowService.getMainWindow()
            if (mainWindow && !mainWindow.isDestroyed()) {
              await dialog.showMessageBox(mainWindow, {
                type: 'error',
                title: 'Security Warning',
                message: 'Cannot install MCP server',
                detail: `Command "${server.command}" is not allowed.\n\nOnly these commands are permitted:\n${ALLOWED_COMMANDS.join(', ')}`
              })
            }
            return
          }
        }

        // Show confirmation dialog
        const mainWindow = windowService.getMainWindow()
        if (mainWindow && !mainWindow.isDestroyed()) {
          const serverDetails = servers
            .map((s) => {
              const lines = [`Name: ${s.name || 'Unknown'}`]
              if (s.command) {
                lines.push(`Command: ${s.command}`)
                if (s.args && s.args.length > 0) {
                  lines.push(`Arguments: ${s.args.join(' ')}`)
                }
              } else if (s.baseUrl) {
                lines.push(`URL: ${s.baseUrl}`)
              }
              return lines.join('\n')
            })
            .join('\n\n')

          const result = await dialog.showMessageBox(mainWindow, {
            type: 'question',
            buttons: ['Cancel', 'Install'],
            defaultId: 0,
            cancelId: 0,
            title: 'Install MCP Server',
            message: 'Do you want to install the following MCP server(s)?',
            detail: serverDetails
          })

          // User cancelled installation
          if (result.response !== 1) {
            logger.info('User cancelled MCP server installation')
            return
          }
        }

        // User confirmed, proceed with installation
        logger.info('User approved MCP server installation')
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

      windowService.getMainWindow()?.show()

      break
    }
    default:
      logger.error(`Unknown MCP protocol URL: ${url}`)
      break
  }
}
