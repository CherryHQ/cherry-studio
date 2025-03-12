import store, { useAppDispatch, useAppSelector } from '@renderer/store'
import { setMCPServers } from '@renderer/store/mcp'
import { MCPServer } from '@renderer/types'
import { useEffect } from 'react'

const ipcRenderer = window.electron.ipcRenderer

// Listen for server changes from main process
ipcRenderer.on('mcp:servers-changed', (_event, servers) => {
  store.dispatch(setMCPServers(servers))
})

export const useMCPServers = () => {
  const mcpServers = useAppSelector((state) => state.mcp.servers)
  const dispatch = useAppDispatch()

  // Send servers to main process when they change in Redux
  useEffect(() => {
    ipcRenderer.send('mcp:servers-from-renderer', mcpServers)
  }, [mcpServers])

  // Initial load of MCP servers from main process
  useEffect(() => {
    const loadServers = async () => {
      try {
        const servers = await window.api.mcp.listServers()
        dispatch(setMCPServers(servers))
      } catch (error) {
        console.error('Failed to load MCP servers:', error)
      }
    }

    loadServers()
  }, [dispatch])

  const addMCPServer = async (server: MCPServer) => {
    try {
      await window.api.mcp.addServer(server)
      // Main process will send back updated servers via mcp:servers-changed
    } catch (error) {
      console.error('Failed to add MCP server:', error)
      throw error
    }
  }

  const updateMCPServer = async (server: MCPServer) => {
    try {
      await window.api.mcp.updateServer(server)
      // Main process will send back updated servers via mcp:servers-changed
    } catch (error) {
      console.error('Failed to update MCP server:', error)
      throw error
    }
  }

  const deleteMCPServer = async (name: string) => {
    try {
      await window.api.mcp.deleteServer(name)
      // Main process will send back updated servers via mcp:servers-changed
    } catch (error) {
      console.error('Failed to delete MCP server:', error)
      throw error
    }
  }

  const setMCPServerActive = async (name: string, isActive: boolean) => {
    try {
      await window.api.mcp.setServerActive(name, isActive)
      // Main process will send back updated servers via mcp:servers-changed
    } catch (error) {
      console.error('Failed to set MCP server active status:', error)
      throw error
    }
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
