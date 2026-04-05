import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import type { SpanContext } from '@opentelemetry/api'
import type { MCPServerLogEntry } from '@shared/config/types'
import { IpcChannel } from '@shared/IpcChannel'
import type { MCPServer } from '@types'
import { ipcRenderer } from 'electron'

import type {
  InstalledSkill,
  LocalSkill,
  SkillFileNode,
  SkillInstallFromDirectoryOptions,
  SkillInstallFromZipOptions,
  SkillInstallOptions,
  SkillResult,
  SkillToggleOptions
} from '../../renderer/src/types/skill'
import { tracedInvoke } from './shared'

export const agentsApi = {
  mcp: {
    removeServer: (server: MCPServer) => ipcRenderer.invoke(IpcChannel.Mcp_RemoveServer, server),
    restartServer: (server: MCPServer) => ipcRenderer.invoke(IpcChannel.Mcp_RestartServer, server),
    stopServer: (server: MCPServer) => ipcRenderer.invoke(IpcChannel.Mcp_StopServer, server),
    listTools: (server: MCPServer, context?: SpanContext) => tracedInvoke(IpcChannel.Mcp_ListTools, context, server),
    callTool: (
      { server, name, args, callId }: { server: MCPServer; name: string; args: any; callId?: string },
      context?: SpanContext
    ) =>
      tracedInvoke(IpcChannel.Mcp_CallTool, context, {
        server,
        name,
        args,
        callId
      }),
    listPrompts: (server: MCPServer) => ipcRenderer.invoke(IpcChannel.Mcp_ListPrompts, server),
    getPrompt: ({ server, name, args }: { server: MCPServer; name: string; args?: Record<string, any> }) =>
      ipcRenderer.invoke(IpcChannel.Mcp_GetPrompt, { server, name, args }),
    listResources: (server: MCPServer) => ipcRenderer.invoke(IpcChannel.Mcp_ListResources, server),
    getResource: ({ server, uri }: { server: MCPServer; uri: string }) =>
      ipcRenderer.invoke(IpcChannel.Mcp_GetResource, { server, uri }),
    getInstallInfo: () => ipcRenderer.invoke(IpcChannel.Mcp_GetInstallInfo),
    checkMcpConnectivity: (server: any) => ipcRenderer.invoke(IpcChannel.Mcp_CheckConnectivity, server),
    uploadDxt: async (file: File) => {
      const buffer = await file.arrayBuffer()
      return ipcRenderer.invoke(IpcChannel.Mcp_UploadDxt, buffer, file.name)
    },
    abortTool: (callId: string) => ipcRenderer.invoke(IpcChannel.Mcp_AbortTool, callId),
    resolveHubTool: (nameOrId: string): Promise<{ serverId: string; toolName: string } | null> =>
      ipcRenderer.invoke(IpcChannel.Mcp_ResolveHubTool, nameOrId),
    getServerVersion: (server: MCPServer): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannel.Mcp_GetServerVersion, server),
    getServerLogs: (server: MCPServer): Promise<MCPServerLogEntry[]> =>
      ipcRenderer.invoke(IpcChannel.Mcp_GetServerLogs, server),
    onServerLog: (callback: (log: MCPServerLogEntry & { serverId?: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, log: MCPServerLogEntry & { serverId?: string }) => {
        callback(log)
      }
      ipcRenderer.on(IpcChannel.Mcp_ServerLog, listener)
      return () => ipcRenderer.off(IpcChannel.Mcp_ServerLog, listener)
    }
  },
  skill: {
    list: (): Promise<SkillResult<InstalledSkill[]>> => ipcRenderer.invoke(IpcChannel.Skill_List),
    install: (options: SkillInstallOptions): Promise<SkillResult<InstalledSkill>> =>
      ipcRenderer.invoke(IpcChannel.Skill_Install, options),
    uninstall: (skillId: string): Promise<SkillResult<void>> => ipcRenderer.invoke(IpcChannel.Skill_Uninstall, skillId),
    toggle: (options: SkillToggleOptions): Promise<SkillResult<InstalledSkill | null>> =>
      ipcRenderer.invoke(IpcChannel.Skill_Toggle, options),
    installFromZip: (options: SkillInstallFromZipOptions): Promise<SkillResult<InstalledSkill>> =>
      ipcRenderer.invoke(IpcChannel.Skill_InstallFromZip, options),
    installFromDirectory: (options: SkillInstallFromDirectoryOptions): Promise<SkillResult<InstalledSkill>> =>
      ipcRenderer.invoke(IpcChannel.Skill_InstallFromDirectory, options),
    readSkillFile: (skillId: string, filename: string): Promise<SkillResult<string | null>> =>
      ipcRenderer.invoke(IpcChannel.Skill_ReadFile, skillId, filename),
    listFiles: (skillId: string): Promise<SkillResult<SkillFileNode[]>> =>
      ipcRenderer.invoke(IpcChannel.Skill_ListFiles, skillId),
    listLocal: (workdir: string): Promise<SkillResult<LocalSkill[]>> =>
      ipcRenderer.invoke(IpcChannel.Skill_ListLocal, workdir)
  },
  agentTools: {
    respondToPermission: (payload: {
      requestId: string
      behavior: 'allow' | 'deny'
      updatedInput?: Record<string, unknown>
      message?: string
      updatedPermissions?: PermissionUpdate[]
    }) => ipcRenderer.invoke(IpcChannel.AgentToolPermission_Response, payload)
  },
  agentSessionStream: {
    subscribe: (sessionId: string) =>
      ipcRenderer.invoke(IpcChannel.AgentSessionStream_Subscribe, {
        sessionId
      }),
    unsubscribe: (sessionId: string) =>
      ipcRenderer.invoke(IpcChannel.AgentSessionStream_Unsubscribe, {
        sessionId
      }),
    abort: (sessionId: string) => ipcRenderer.invoke(IpcChannel.AgentSessionStream_Abort, { sessionId }),
    onChunk: (
      callback: (chunk: {
        sessionId: string
        agentId: string
        type: string
        chunk?: any
        error?: any
        userMessage?: {
          chatId: string
          userId: string
          userName: string
          text: string
          images?: Array<{ data: string; media_type: string }>
          files?: Array<{ filename: string; media_type: string; size: number }>
        }
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        chunk: {
          sessionId: string
          agentId: string
          type: string
          chunk?: any
          error?: any
          userMessage?: {
            chatId: string
            userId: string
            userName: string
            text: string
            images?: Array<{ data: string; media_type: string }>
            files?: Array<{
              filename: string
              media_type: string
              size: number
            }>
          }
        }
      ) => {
        callback(chunk)
      }
      ipcRenderer.on(IpcChannel.AgentSessionStream_Chunk, listener)
      return () => ipcRenderer.off(IpcChannel.AgentSessionStream_Chunk, listener)
    },
    onSessionChanged: (
      callback: (data: { agentId: string; sessionId: string; headless?: boolean }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { agentId: string; sessionId: string; headless?: boolean }
      ) => {
        callback(data)
      }
      ipcRenderer.on(IpcChannel.AgentSession_Changed, listener)
      return () => ipcRenderer.off(IpcChannel.AgentSession_Changed, listener)
    }
  },
  channel: {
    onLog: (
      callback: (log: { timestamp: number; level: string; message: string; channelId: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        log: {
          timestamp: number
          level: string
          message: string
          channelId: string
        }
      ) => {
        callback(log)
      }
      ipcRenderer.on(IpcChannel.Channel_Log, listener)
      return () => ipcRenderer.off(IpcChannel.Channel_Log, listener)
    },
    onStatusChange: (
      callback: (status: { channelId: string; connected: boolean; error?: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        status: { channelId: string; connected: boolean; error?: string }
      ) => {
        callback(status)
      }
      ipcRenderer.on(IpcChannel.Channel_StatusChange, listener)
      return () => ipcRenderer.off(IpcChannel.Channel_StatusChange, listener)
    },
    getLogs: (
      channelId: string
    ): Promise<
      Array<{
        timestamp: number
        level: string
        message: string
        channelId: string
      }>
    > => ipcRenderer.invoke(IpcChannel.Channel_GetLogs, channelId),
    getStatuses: (): Promise<Array<{ channelId: string; connected: boolean; error?: string }>> =>
      ipcRenderer.invoke(IpcChannel.Channel_GetStatuses)
  },
  wechat: {
    onQrLogin: (
      callback: (data: { channelId: string; agentId: string; url: string; status: string; userId?: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          channelId: string
          agentId: string
          url: string
          status: string
          userId?: string
        }
      ) => {
        callback(data)
      }
      ipcRenderer.on(IpcChannel.WeChat_QrLogin, listener)
      return () => ipcRenderer.off(IpcChannel.WeChat_QrLogin, listener)
    },
    hasCredentials: (channelId: string): Promise<{ exists: boolean; userId?: string }> =>
      ipcRenderer.invoke(IpcChannel.WeChat_HasCredentials, channelId)
  },
  feishu: {
    onQrLogin: (
      callback: (data: {
        channelId: string
        agentId: string
        url: string
        status: string
        appId?: string
        appSecret?: string
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          channelId: string
          agentId: string
          url: string
          status: string
          appId?: string
          appSecret?: string
        }
      ) => {
        callback(data)
      }
      ipcRenderer.on(IpcChannel.Feishu_QrLogin, listener)
      return () => ipcRenderer.off(IpcChannel.Feishu_QrLogin, listener)
    }
  }
}
