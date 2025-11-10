import { createSelector } from '@reduxjs/toolkit'
import NavigationService from '@renderer/services/NavigationService'
import store, { RootState, useAppDispatch, useAppSelector } from '@renderer/store'
import { addMCPServer, deleteMCPServer, setMCPServers, updateMCPServer } from '@renderer/store/mcp'
import { MCPServer } from '@renderer/types'
import { IpcChannel } from '@shared/IpcChannel'

// Initialize IPC listeners when window.electron is available
const initializeMCPListeners = () => {
  if (!window.electron?.ipcRenderer) {
    // If window.electron is not ready, wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initializeMCPListeners)
    } else {
      // If DOM is ready but electron is not, try once more after a short delay
      setTimeout(() => {
        if (window.electron?.ipcRenderer) {
          initializeMCPListeners()
        }
      }, 100)
    }
    return
  }

  // Listen for server changes from main process
  window.electron.ipcRenderer.on(IpcChannel.Mcp_ServersChanged, (_event, servers) => {
    store.dispatch(setMCPServers(servers))
  })

  window.electron.ipcRenderer.on(IpcChannel.Mcp_AddServer, (_event, server: MCPServer) => {
    store.dispatch(addMCPServer(server))
    NavigationService.navigate?.('/settings/mcp')
    NavigationService.navigate?.(`/settings/mcp/settings/${encodeURIComponent(server.id)}`)
  })
}

// Initialize listeners
if (typeof window !== 'undefined') {
  initializeMCPListeners()
}

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
