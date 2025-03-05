import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addMCPServer as _addMCPServer,
  deleteMCPServer as _deleteMCPServer,
  setMCPServerActive as _setMCPServerActive,
  updateMCPServer as _updateMCPServer
} from '@renderer/store/mcp'
import { MCPServer } from '@renderer/types'

export const useMCPServers = () => {
  const mcpServers = useAppSelector((state) => state.mcp.servers)
  const dispatch = useAppDispatch()

  const addMCPServer = (server: MCPServer) => {
    dispatch(_addMCPServer(server))
  }

  const updateMCPServer = (server: MCPServer) => {
    dispatch(_updateMCPServer(server))
  }

  const deleteMCPServer = (name: string) => {
    dispatch(_deleteMCPServer(name))
  }

  const setMCPServerActive = (name: string, isActive: boolean) => {
    dispatch(_setMCPServerActive({ name, isActive }))
  }

  const getActiveMCPServers = () => {
    return mcpServers.filter((server) => server.isActive)
  }

  return {
    mcpServers,
    addMCPServer,
    updateMCPServer,
    deleteMCPServer,
    setMCPServerActive,
    getActiveMCPServers
  }
}
