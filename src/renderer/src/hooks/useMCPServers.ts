import store, { useAppDispatch, useAppSelector } from '@renderer/store'
import { addMCPServer, deleteMCPServer, setMCPServers, updateMCPServer } from '@renderer/store/mcp'
import { MCPServer } from '@renderer/types'
import { IpcChannel } from '@shared/IpcChannel'

const ipcRenderer = window.electron.ipcRenderer

// Listen for server changes from main process
ipcRenderer.on(IpcChannel.Mcp_ServersChanged, (_event, servers) => {
  store.dispatch(setMCPServers(servers))
})

export const useMCPServers = () => {
  const mcpServers = useAppSelector((state) => state.mcp.servers)
  const activedMcpServers = mcpServers.filter((server) => server.isActive)
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
