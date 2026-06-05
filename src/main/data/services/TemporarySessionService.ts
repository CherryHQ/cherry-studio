/**
 * TemporarySessionService - in-memory backend for temporary agent sessions.
 *
 * Temporary sessions live only in main-process memory until explicitly
 * persisted. Persisting promotes the draft through AgentSessionService using
 * the same id; deleting the draft or exiting the process discards it.
 */

import { agentService } from '@data/services/AgentService'
import { agentSessionWorkflowService } from '@data/services/AgentSessionWorkflowService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { DataApiErrorFactory } from '@shared/data/api'
import type { AgentSessionEntity, AgentWorkspaceMode } from '@shared/data/api/schemas/agentSessions'
import type { CreateTemporarySessionDto, TemporarySessionEntity } from '@shared/data/api/schemas/temporaryChats'
import { v4 as uuidv4 } from 'uuid'

type TemporarySessionRow = {
  id: string
  agentId: string
  name: string
  description: string
  workspaceId?: string
  workspaceMode?: AgentWorkspaceMode
  createdAt: number
  updatedAt: number
}

function rowToSession(
  row: TemporarySessionRow,
  workspace: TemporarySessionEntity['workspace']
): TemporarySessionEntity {
  const base = {
    id: row.id,
    agentId: row.agentId,
    name: row.name,
    description: row.description,
    orderKey: '',
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
  if (row.workspaceMode === 'system') {
    return {
      ...base,
      workspaceId: null,
      workspace: null,
      workspaceMode: 'system'
    }
  }
  if (!row.workspaceId || !workspace) {
    throw DataApiErrorFactory.invalidOperation('map temporary session', 'user workspace is missing')
  }
  return {
    ...base,
    workspaceId: row.workspaceId,
    workspace
  }
}

export class TemporarySessionService {
  private readonly sessions = new Map<string, TemporarySessionRow>()

  async createSession(dto: CreateTemporarySessionDto): Promise<TemporarySessionEntity> {
    const agentId = dto.agentId?.trim()
    if (!agentId) {
      throw DataApiErrorFactory.validation({ agentId: ['is required'] })
    }

    const now = Date.now()
    const id = uuidv4()
    const workspace = dto.workspaceMode === 'system' ? null : await agentWorkspaceService.getById(dto.workspaceId)

    const row: TemporarySessionRow = {
      id,
      agentId,
      name: dto.name?.trim() || 'Untitled',
      description: dto.description ?? '',
      workspaceId: workspace?.id,
      workspaceMode: dto.workspaceMode,
      createdAt: now,
      updatedAt: now
    }

    this.sessions.set(row.id, row)
    return rowToSession(row, workspace)
  }

  async deleteSession(id: string): Promise<void> {
    const row = this.sessions.get(id)
    if (!row) {
      throw DataApiErrorFactory.notFound('TemporarySession', id)
    }
    this.sessions.delete(id)
  }

  async persist(id: string): Promise<AgentSessionEntity> {
    const row = this.sessions.get(id)
    if (!row) {
      throw DataApiErrorFactory.notFound('TemporarySession', id)
    }

    const agent = await agentService.getAgent(row.agentId)
    if (!agent) {
      throw DataApiErrorFactory.notFound('Agent', row.agentId)
    }
    if (!agent.model) {
      throw DataApiErrorFactory.validation({ agentId: ['agent has no model configured'] })
    }

    this.sessions.delete(id)
    try {
      const workspaceInput =
        row.workspaceMode === 'system' ? { workspaceMode: row.workspaceMode } : { workspaceId: row.workspaceId }
      return await agentSessionWorkflowService.createSession(
        {
          agentId: row.agentId,
          name: row.name,
          description: row.description,
          ...workspaceInput
        },
        { id: row.id }
      )
    } catch (err) {
      this.sessions.set(id, row)
      throw err
    }
  }
}

export const temporarySessionService = new TemporarySessionService()
