/**
 * In-memory backend for temporary agent session drafts.
 *
 * Drafts are not persisted and do not own workspace filesystem preparation.
 * Persisting promotes the latest draft configuration through AgentSessionService.
 */

import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { DataApiErrorFactory } from '@shared/data/api'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentSessionWorkspaceSource, AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import type {
  CreateTemporarySessionDto,
  TemporarySessionEntity,
  UpdateTemporarySessionDto
} from '@shared/data/api/schemas/temporaryChats'
import { v4 as uuidv4 } from 'uuid'

type TemporarySessionRow = {
  id: string
  agentId: string
  workspaceSource: AgentSessionWorkspaceSource
  createdAt: number
  updatedAt: number
}

function rowToSession(row: TemporarySessionRow, workspace: AgentWorkspaceEntity | null): TemporarySessionEntity {
  return {
    id: row.id,
    agentId: row.agentId,
    workspaceSource: row.workspaceSource,
    workspace,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

export class TemporaryAgentSessionDraftService {
  private readonly sessions = new Map<string, TemporarySessionRow>()

  async createSession(dto: CreateTemporarySessionDto): Promise<TemporarySessionEntity> {
    await this.assertAgentExists(dto.agentId)
    const workspace = await this.resolveWorkspace(dto.workspace)
    const now = Date.now()
    const row: TemporarySessionRow = {
      id: uuidv4(),
      agentId: dto.agentId.trim(),
      workspaceSource: dto.workspace,
      createdAt: now,
      updatedAt: now
    }

    this.sessions.set(row.id, row)
    return rowToSession(row, workspace)
  }

  async updateSession(id: string, dto: UpdateTemporarySessionDto): Promise<TemporarySessionEntity> {
    const row = this.sessions.get(id)
    if (!row) {
      throw DataApiErrorFactory.notFound('TemporarySession', id)
    }

    let workspace: AgentWorkspaceEntity | null
    if (dto.agentId !== undefined) {
      await this.assertAgentExists(dto.agentId)
      row.agentId = dto.agentId.trim()
    }
    if (dto.workspace !== undefined) {
      workspace = await this.resolveWorkspace(dto.workspace)
      row.workspaceSource = dto.workspace
    } else {
      workspace = await this.resolveWorkspace(row.workspaceSource)
    }
    row.updatedAt = Date.now()

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

    await this.assertAgentExists(row.agentId)
    await this.resolveWorkspace(row.workspaceSource)

    this.sessions.delete(id)
    try {
      return await agentSessionService.create({
        agentId: row.agentId,
        name: 'Untitled',
        workspace: row.workspaceSource
      })
    } catch (err) {
      this.sessions.set(id, row)
      throw err
    }
  }

  private async assertAgentExists(agentId: string): Promise<void> {
    const trimmed = agentId.trim()
    if (!trimmed) {
      throw DataApiErrorFactory.validation({ agentId: ['is required'] })
    }
    const agent = await agentService.getAgent(trimmed)
    if (!agent) {
      throw DataApiErrorFactory.notFound('Agent', trimmed)
    }
  }

  private async resolveWorkspace(source: AgentSessionWorkspaceSource): Promise<AgentWorkspaceEntity | null> {
    switch (source.type) {
      case AGENT_WORKSPACE_TYPE.SYSTEM:
        return null
      case AGENT_WORKSPACE_TYPE.USER: {
        const workspace = await agentWorkspaceService.getById(source.workspaceId)
        if (workspace.type !== AGENT_WORKSPACE_TYPE.USER) {
          throw DataApiErrorFactory.invalidOperation(
            'temporary session workspace',
            'workspace source must reference a user workspace'
          )
        }
        return workspace
      }
      default: {
        const exhaustive: never = source
        throw DataApiErrorFactory.invalidOperation(
          'temporary session workspace',
          `unsupported workspace source: ${String(exhaustive)}`
        )
      }
    }
  }
}

export const temporarySessionService = new TemporaryAgentSessionDraftService()
