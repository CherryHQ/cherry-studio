import { ipcRenderer } from 'electron'
import { IpcChannel } from '@shared/IpcChannel'

// =============================================================================
// TYPES AND INTERFACES
// =============================================================================

export interface AgentMessage {
  id: string
  type: 'request' | 'response' | 'stream' | 'stream-start' | 'stream-end' | 'stream-error'
  payload: Record<string, any>
  timestamp: number
}

export interface AgentIPCResult {
  success: boolean
  error?: string
  data?: any
}

export type MessageListener = (message: AgentMessage) => void
export type StreamDataListener = (data: AgentMessage) => void
export type StreamEndListener = (message: AgentMessage) => void
export type StreamErrorListener = (error: AgentMessage) => void

// =============================================================================
// AGENT IPC BRIDGE CLASS
// =============================================================================

export class AgentIPCBridge {
  // ===========================================================================
  // MESSAGE SENDING
  // ===========================================================================

  async sendMessage(message: AgentMessage): Promise<AgentIPCResult> {
    try {
      // Basic client-side validation
      if (!this.isValidMessage(message)) {
        return {
          success: false,
          error: 'Message validation failed: invalid message structure'
        }
      }

      const result = await ipcRenderer.invoke(IpcChannel.Agent_Send_Message, message)
      return result
    } catch (error) {
      console.error('Agent IPC Error:', error)
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      
      // Handle specific IPC errors
      if (errorMessage.includes('Object has been destroyed')) {
        return {
          success: false,
          error: 'IPC channel unavailable: renderer process destroyed'
        }
      }

      return {
        success: false,
        error: `IPC channel error: ${errorMessage}`
      }
    }
  }

  async sendStreamMessage(message: AgentMessage): Promise<AgentIPCResult> {
    try {
      // Validate stream message
      if (!this.isValidStreamMessage(message)) {
        return {
          success: false,
          error: 'Invalid stream message: missing stream field or invalid structure'
        }
      }

      const result = await ipcRenderer.invoke(IpcChannel.Agent_Stream_Message, message)
      return result
    } catch (error) {
      console.error('Agent Stream IPC Error:', error)
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      
      return {
        success: false,
        error: `Stream IPC error: ${errorMessage}`
      }
    }
  }

  // ===========================================================================
  // MESSAGE LISTENING
  // ===========================================================================

  onMessage(listener: MessageListener): () => void {
    const wrappedListener = (_event: Electron.IpcRendererEvent, message: AgentMessage) => {
      // Validate received message before passing to listener
      if (this.isValidMessage(message)) {
        listener(message)
      }
    }

    ipcRenderer.on(IpcChannel.Agent_Message_Received, wrappedListener)

    // Return cleanup function
    return () => {
      ipcRenderer.off(IpcChannel.Agent_Message_Received, wrappedListener)
    }
  }

  onStreamData(listener: StreamDataListener): () => void {
    const wrappedListener = (_event: Electron.IpcRendererEvent, data: AgentMessage) => {
      if (this.isValidMessage(data)) {
        listener(data)
      }
    }

    ipcRenderer.on(IpcChannel.Agent_Stream_Data, wrappedListener)

    return () => {
      ipcRenderer.off(IpcChannel.Agent_Stream_Data, wrappedListener)
    }
  }

  onStreamEnd(listener: StreamEndListener): () => void {
    const wrappedListener = (_event: Electron.IpcRendererEvent, message: AgentMessage) => {
      if (this.isValidMessage(message)) {
        listener(message)
      }
    }

    ipcRenderer.on(IpcChannel.Agent_Stream_End, wrappedListener)

    return () => {
      ipcRenderer.off(IpcChannel.Agent_Stream_End, wrappedListener)
    }
  }

  onStreamError(listener: StreamErrorListener): () => void {
    const wrappedListener = (_event: Electron.IpcRendererEvent, error: AgentMessage) => {
      if (this.isValidMessage(error)) {
        listener(error)
      }
    }

    ipcRenderer.on(IpcChannel.Agent_Stream_Error, wrappedListener)

    return () => {
      ipcRenderer.off(IpcChannel.Agent_Stream_Error, wrappedListener)
    }
  }

  // ===========================================================================
  // VALIDATION HELPERS
  // ===========================================================================

  private isValidMessage(message: any): message is AgentMessage {
    return (
      message &&
      typeof message === 'object' &&
      typeof message.id === 'string' &&
      message.id.length > 0 &&
      typeof message.type === 'string' &&
      message.payload &&
      typeof message.payload === 'object' &&
      typeof message.timestamp === 'number' &&
      !isNaN(message.timestamp)
    )
  }

  private isValidStreamMessage(message: any): boolean {
    if (!this.isValidMessage(message)) {
      return false
    }

    // For 'stream' type messages, require stream: true in payload
    if (message.type === 'stream') {
      return message.payload.stream === true
    }
    
    // For other stream-related types (stream-start, stream-end, stream-error), 
    // they are valid by type alone
    return message.type.startsWith('stream')
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

// Create singleton instance for use in context bridge
export const agentIPC = new AgentIPCBridge()