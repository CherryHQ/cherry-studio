/**
 * In-memory backend for temporary agent session drafts.
 *
 * Drafts are not persisted and do not own workspace filesystem preparation.
 * Persisting only hands the latest draft parameters back to the caller.
 */

import { DataApiErrorFactory } from '@shared/data/api'
import type { AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
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

function timestampToISO(timestamp: number): string {
  return new Date(timestamp).toISOString()
}

function rowToSession(row: TemporarySessionRow): TemporarySessionEntity {
  return {
    id: row.id,
    agentId: row.agentId,
    workspaceSource: row.workspaceSource,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

export class TemporaryAgentSessionDraftService {
  private readonly sessions = new Map<string, TemporarySessionRow>()

  async createSession(dto: CreateTemporarySessionDto): Promise<TemporarySessionEntity> {
    const now = Date.now()
    const row: TemporarySessionRow = {
      id: uuidv4(),
      agentId: dto.agentId,
      workspaceSource: dto.workspace,
      createdAt: now,
      updatedAt: now
    }

    this.sessions.set(row.id, row)
    return rowToSession(row)
  }

  async updateSession(id: string, dto: UpdateTemporarySessionDto): Promise<TemporarySessionEntity> {
    const row = this.sessions.get(id)
    if (!row) {
      throw DataApiErrorFactory.notFound('TemporarySession', id)
    }

    if (dto.agentId !== undefined) {
      row.agentId = dto.agentId
    }
    if (dto.workspace !== undefined) {
      row.workspaceSource = dto.workspace
    }
    row.updatedAt = Date.now()

    return rowToSession(row)
  }

  async deleteSession(id: string): Promise<void> {
    const row = this.sessions.get(id)
    if (!row) {
      throw DataApiErrorFactory.notFound('TemporarySession', id)
    }
    this.sessions.delete(id)
  }

  async persist(id: string): Promise<TemporarySessionEntity> {
    const row = this.sessions.get(id)
    if (!row) {
      throw DataApiErrorFactory.notFound('TemporarySession', id)
    }

    this.sessions.delete(id)
    return rowToSession(row)
  }
}

export const temporarySessionService = new TemporaryAgentSessionDraftService()
