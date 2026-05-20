import { loggerService } from '@logger'
import type { AgentEntity, AgentStyleMode, AgentType, FileMetadata, WorkerInstanceRole } from '@renderer/types'
import type { Axios, AxiosRequestConfig } from 'axios'
import axios, { isAxiosError } from 'axios'

const logger = loggerService.withContext('CollaborationApiClient')

export type CollaborationRoomStatus = 'todo' | 'in_progress' | 'needs_confirmation' | 'done' | 'blocked'
export type CollaborationRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type CollaborationWorkerRuntimeStatus = 'unbound' | 'missing_command' | 'online' | 'running' | 'offline'
export type VisibleWorkerType = Extract<AgentType, 'codex' | 'opencode' | 'claude-code' | 'gemini-cli' | 'hermes'>

export interface CollaborationRoomAutonomyConfig {
  enabled: boolean
  idleMinutes: number
  paused: boolean
  routerAgentId?: string
  lastTriggeredAt?: string
  lastResult?: {
    status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled' | 'no_op'
    summary: string
    source: 'manual' | 'idle'
    at: string
    runId?: string
  }
}

export interface CollaborationRoomAutonomyState {
  enabled: boolean
  paused: boolean
  idleMinutes: number
  routerAgentId?: string
  status: 'disabled' | 'paused' | 'waiting' | 'running' | 'ready'
  idleSince?: string
  nextRunAt?: string
  remainingMs?: number
  activeRunId?: string
  lastResult?: CollaborationRoomAutonomyConfig['lastResult']
}

export interface CollaborationWorkspace {
  id: string
  name: string
  description?: string
  rootPaths: string[]
  routerAgentId?: string
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface CollaborationRoom {
  id: string
  workspaceId: string
  title: string
  description?: string
  status: CollaborationRoomStatus
  assignedAgentId?: string
  metadata?: Record<string, unknown>
  autonomy?: CollaborationRoomAutonomyConfig
  createdAt: string
  updatedAt: string
  lastActivityAt: string
}

export interface CollaborationRoomMember {
  roomId: string
  memberType: 'user' | 'agent'
  memberId: string
  role: 'owner' | 'participant'
  displayName?: string
  metadata?: Record<string, unknown>
  joinedAt: string
  updatedAt: string
}

export interface CollaborationRoomMessage {
  id: string
  roomId: string
  authorType: 'user' | 'agent' | 'system'
  authorId?: string
  kind: 'message' | 'task' | 'event'
  intent: 'message' | 'task'
  routing: 'none' | 'elite'
  parentMessageId?: string
  content: string
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface CollaborationRoomRun {
  id: string
  roomId: string
  workerAgentId: string
  triggerMessageId?: string
  sessionId?: string
  status: CollaborationRunStatus
  commandSnapshot?: string
  argsSnapshot?: string[]
  summary?: string
  result?: string
  error?: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
}

export interface CollaborationAssignAndRunResult {
  roomId: string
  taskMessageId: string
  targetAgentId: string
  effectiveTargetAgentId?: string
  status: 'started' | 'deferred'
  eventMessage: string
}

export interface MobileAccessInfo {
  machineName?: string
  lanHost: string
  lanHosts?: string[]
  tailscaleHosts?: string[]
  port: number
  localUrl?: string
  lanUrls?: string[]
  tailscaleUrls?: string[]
  recommendedServiceUrl?: string
  mobileUrl: string
}

export interface CollaborationWorkerInstanceRuntime {
  key: string
  family: VisibleWorkerType
  type: VisibleWorkerType
  label: string
  engine: string
  role: WorkerInstanceRole
  agent: AgentEntity
  command?: string
  resolvedCommand?: string
  version?: string
  status: CollaborationWorkerRuntimeStatus
  healthLabel: string
  canRun: boolean
  workload: {
    activeRuns: number
    label: string
  }
  styleMode: AgentStyleMode
  styleLabel: string
  displayModelId?: string
  displayModelName?: string
  modelManagedBy?: 'cherry' | 'worker'
  lastHeartbeatAt?: string
  message?: string
}

export interface CollaborationWorkerFamilyRuntime {
  key: VisibleWorkerType
  type: VisibleWorkerType
  label: string
  engine: string
  defaultCommand?: string
  defaultArgs: string[]
  tags: string[]
  agent?: AgentEntity
  command?: string
  resolvedCommand?: string
  version?: string
  status: CollaborationWorkerRuntimeStatus
  healthLabel: string
  canRun: boolean
  workload: {
    activeRuns: number
    label: string
  }
  styleMode: AgentStyleMode
  styleLabel: string
  displayModelId?: string
  displayModelName?: string
  modelManagedBy?: 'cherry' | 'worker'
  lastHeartbeatAt?: string
  message?: string
  instances: CollaborationWorkerInstanceRuntime[]
  primaryInstanceId?: string
}

const processError = (error: unknown, fallbackMessage: string) => {
  logger.error(fallbackMessage, error as Error)
  if (isAxiosError(error) && error.response?.data?.error?.message) {
    return new Error(String(error.response.data.error.message))
  }
  return new Error(fallbackMessage, { cause: error })
}

export class CollaborationApiClient {
  private axios: Axios

  constructor(config: AxiosRequestConfig) {
    if (!config.baseURL || !config.headers?.Authorization) {
      throw new Error('Please pass in baseUrl and Authorization header.')
    }
    this.axios = axios.create(config)
  }

  async listWorkspaces(): Promise<CollaborationWorkspace[]> {
    try {
      const response = await this.axios.get('/v1/collaboration/workspaces')
      return response.data.data ?? []
    } catch (error) {
      throw processError(error, 'Failed to list collaboration workspaces.')
    }
  }

  async getMobileAccessInfo(): Promise<MobileAccessInfo> {
    try {
      const response = await this.axios.get('/mobile/api/info')
      return response.data
    } catch (error) {
      throw processError(error, 'Failed to get mobile access info.')
    }
  }

  async listWorkers(): Promise<CollaborationWorkerFamilyRuntime[]> {
    try {
      const response = await this.axios.get('/v1/collaboration/workers')
      return response.data.data ?? []
    } catch (error) {
      throw processError(error, 'Failed to list collaboration workers.')
    }
  }

  async bindWorker(workerType: VisibleWorkerType): Promise<CollaborationWorkerFamilyRuntime> {
    try {
      const response = await this.axios.post(`/v1/collaboration/workers/${workerType}/bind`)
      return response.data
    } catch (error) {
      throw processError(error, 'Failed to bind collaboration worker.')
    }
  }

  async createWorkerInstance(workerType: VisibleWorkerType): Promise<CollaborationWorkerFamilyRuntime> {
    try {
      const response = await this.axios.post(`/v1/collaboration/workers/${workerType}/instances`)
      return response.data
    } catch (error) {
      throw processError(error, 'Failed to create collaboration worker instance.')
    }
  }

  async createWorkspace(input: { name: string; rootPaths?: string[] }): Promise<CollaborationWorkspace> {
    try {
      const response = await this.axios.post('/v1/collaboration/workspaces', input)
      return response.data
    } catch (error) {
      throw processError(error, 'Failed to create collaboration workspace.')
    }
  }

  async listRooms(workspaceId: string): Promise<CollaborationRoom[]> {
    try {
      const response = await this.axios.get('/v1/collaboration/rooms', {
        params: { workspaceId }
      })
      return response.data.data ?? []
    } catch (error) {
      throw processError(error, 'Failed to list collaboration rooms.')
    }
  }

  async updateRoom(
    roomId: string,
    input: Partial<Pick<CollaborationRoom, 'title' | 'description' | 'status' | 'assignedAgentId' | 'metadata'>>
  ): Promise<CollaborationRoom> {
    try {
      const response = await this.axios.patch(`/v1/collaboration/rooms/${roomId}`, input)
      return response.data
    } catch (error) {
      throw processError(error, 'Failed to update collaboration room.')
    }
  }

  async archiveRoom(roomId: string): Promise<CollaborationRoom> {
    try {
      const response = await this.axios.post(`/v1/collaboration/rooms/${roomId}/archive`)
      return response.data
    } catch (error) {
      throw processError(error, 'Failed to archive collaboration room.')
    }
  }

  async reorderWorkers(orderedKeys: VisibleWorkerType[]): Promise<CollaborationWorkerFamilyRuntime[]> {
    try {
      const response = await this.axios.patch('/v1/collaboration/workers/order', { orderedKeys })
      return response.data.data ?? []
    } catch (error) {
      throw processError(error, 'Failed to reorder collaboration workers.')
    }
  }

  async createRoom(input: {
    workspaceId: string
    title: string
    description?: string
    status?: CollaborationRoom['status']
    assignedAgentId?: string
    metadata?: Record<string, unknown>
  }): Promise<CollaborationRoom> {
    try {
      const response = await this.axios.post('/v1/collaboration/rooms', input)
      return response.data
    } catch (error) {
      throw processError(error, 'Failed to create collaboration room.')
    }
  }

  async listRoomMembers(roomId: string): Promise<CollaborationRoomMember[]> {
    try {
      const response = await this.axios.get(`/v1/collaboration/rooms/${roomId}/members`)
      return response.data.data ?? []
    } catch (error) {
      throw processError(error, 'Failed to list collaboration room members.')
    }
  }

  async createRoomMember(
    roomId: string,
    input: Pick<CollaborationRoomMember, 'memberType' | 'memberId'> &
      Partial<Pick<CollaborationRoomMember, 'role' | 'displayName' | 'metadata'>>
  ): Promise<CollaborationRoomMember> {
    try {
      const response = await this.axios.post(`/v1/collaboration/rooms/${roomId}/members`, input)
      return response.data
    } catch (error) {
      throw processError(error, 'Failed to add collaboration room member.')
    }
  }

  async deleteRoomMember(roomId: string, memberType: 'user' | 'agent', memberId: string): Promise<void> {
    try {
      await this.axios.delete(`/v1/collaboration/rooms/${roomId}/members/${memberType}/${memberId}`)
    } catch (error) {
      throw processError(error, 'Failed to remove collaboration room member.')
    }
  }

  async getRoomAutonomy(roomId: string): Promise<CollaborationRoomAutonomyState> {
    try {
      const response = await this.axios.get(`/v1/collaboration/rooms/${roomId}/autonomy`)
      return response.data
    } catch (error) {
      throw processError(error, 'Failed to load room autonomy state.')
    }
  }

  async updateRoomAutonomy(
    roomId: string,
    input: Partial<Pick<CollaborationRoomAutonomyConfig, 'enabled' | 'idleMinutes' | 'paused' | 'routerAgentId'>>
  ): Promise<CollaborationRoomAutonomyState> {
    try {
      const response = await this.axios.patch(`/v1/collaboration/rooms/${roomId}/autonomy`, input)
      return response.data
    } catch (error) {
      throw processError(error, 'Failed to update room autonomy.')
    }
  }

  async runRoomAutonomy(roomId: string): Promise<CollaborationRoomAutonomyState> {
    try {
      const response = await this.axios.post(`/v1/collaboration/rooms/${roomId}/autonomy/run-now`)
      return response.data
    } catch (error) {
      throw processError(error, 'Failed to start room autonomy.')
    }
  }

  async stopRoomAutonomy(roomId: string): Promise<CollaborationRoomAutonomyState> {
    try {
      const response = await this.axios.post(`/v1/collaboration/rooms/${roomId}/autonomy/stop`)
      return response.data
    } catch (error) {
      throw processError(error, 'Failed to stop room autonomy.')
    }
  }

  async listRoomMessages(roomId: string): Promise<CollaborationRoomMessage[]> {
    try {
      const response = await this.axios.get(`/v1/collaboration/rooms/${roomId}/messages`)
      return response.data.data ?? []
    } catch (error) {
      throw processError(error, 'Failed to list collaboration room messages.')
    }
  }

  async createRoomMessage(
    roomId: string,
    input: Pick<CollaborationRoomMessage, 'authorType' | 'content'> &
      Partial<Pick<CollaborationRoomMessage, 'authorId' | 'kind' | 'intent' | 'routing' | 'metadata'>>
  ): Promise<CollaborationRoomMessage> {
    try {
      const response = await this.axios.post(`/v1/collaboration/rooms/${roomId}/messages`, input)
      return response.data
    } catch (error) {
      throw processError(error, 'Failed to create collaboration room message.')
    }
  }

  async assignAndRun(
    roomId: string,
    input: {
      targetAgentId: string
      content?: string
      attachments?: FileMetadata[]
      reasoningEffort?: string
      permissionMode?: string
      toolsEnabled?: boolean
    }
  ): Promise<CollaborationAssignAndRunResult> {
    try {
      const response = await this.axios.post(`/v1/collaboration/rooms/${roomId}/assign-and-run`, input)
      return response.data
    } catch (error) {
      throw processError(error, 'Failed to assign and run collaboration room task.')
    }
  }

  async listRoomRuns(roomId: string): Promise<CollaborationRoomRun[]> {
    try {
      const response = await this.axios.get(`/v1/collaboration/rooms/${roomId}/runs`)
      return response.data.data ?? []
    } catch (error) {
      throw processError(error, 'Failed to list collaboration room runs.')
    }
  }

  async stopRoomRun(runId: string): Promise<void> {
    try {
      await this.axios.post(`/v1/collaboration/runs/${runId}/stop`)
    } catch (error) {
      throw processError(error, 'Failed to stop collaboration room run.')
    }
  }
}
