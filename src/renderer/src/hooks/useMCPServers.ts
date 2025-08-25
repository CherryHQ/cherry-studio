import { createSelector } from '@reduxjs/toolkit'
import NavigationService from '@renderer/services/NavigationService'
import store, { RootState, useAppDispatch, useAppSelector } from '@renderer/store'
import { addMCPServer, deleteMCPServer, setMCPServers, updateMCPServer } from '@renderer/store/mcp'
import { MCPServer } from '@renderer/types'
import { IpcChannel } from '@shared/IpcChannel'
import { t } from 'i18next'

// Listen for server changes from main process
window.electron.ipcRenderer.on(IpcChannel.Mcp_ServersChanged, (_event, servers) => {
  store.dispatch(setMCPServers(servers))
})

window.electron.ipcRenderer.on(IpcChannel.Mcp_AddServer, (_event, server: MCPServer | null) => {
  if (server === null) {
    window.message.error(t('error.mcp.add.invalid_server'))
    return
  }
  // Prepare MCP data for URL parameter
  const mcpData = {
    id: server.id,
    name: server.name,
    command: server.command,
    baseUrl: server.baseUrl,
    type: server.type,
    description: server.description
  }

  // Navigate to MCP settings with addMcpData parameter
  const addMcpDataParam = encodeURIComponent(JSON.stringify(mcpData))
  NavigationService.navigate?.(`/settings/mcp?addMcpData=${addMcpDataParam}`)
})

const selectMcpServers = (state: RootState) => state.mcp.servers
const selectActiveMcpServers = createSelector([selectMcpServers], (servers) =>
  servers.filter((server) => server.isActive)
)

export const useMCPServers = () => {
  const mcpServers = useAppSelector(selectMcpServers)
  const activedMcpServers = useAppSelector(selectActiveMcpServers)
  const dispatch = useAppDispatch()

  return {
    mcpServers,
    activedMcpServers,
    addMCPServer: (server: MCPServer) => dispatch(addMCPServer(server)),
    updateMCPServer: (server: MCPServer) => dispatch(updateMCPServer(server)),
    deleteMCPServer: (id: string) => dispatch(deleteMCPServer(id)),
    setMCPServerActive: (server: MCPServer, isActive: boolean) => dispatch(updateMCPServer({ ...server, isActive })),
    getActiveMCPServers: () => mcpServers.filter((server) => server.isActive),
    updateMcpServers: (servers: MCPServer[]) => dispatch(setMCPServers(servers))
  }
}

export const useMCPServer = (id: string) => {
  const server = useAppSelector((state) => (state.mcp.servers || []).find((server) => server.id === id))
  const dispatch = useAppDispatch()

  return {
    server,
    updateMCPServer: (server: MCPServer) => dispatch(updateMCPServer(server)),
    setMCPServerActive: (server: MCPServer, isActive: boolean) => dispatch(updateMCPServer({ ...server, isActive })),
    deleteMCPServer: (id: string) => dispatch(deleteMCPServer(id))
  }
}
