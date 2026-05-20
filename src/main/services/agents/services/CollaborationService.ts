import { randomUUID } from 'node:crypto'

import { loggerService } from '@logger'
import { and, asc, desc, eq } from 'drizzle-orm'

import { BaseService } from '../BaseService'
import {
  type CollaborationRoomMemberRow,
  collaborationRoomMembersTable,
  type CollaborationRoomMessageRow,
  collaborationRoomMessagesTable,
  type CollaborationRoomRow,
  type CollaborationRoomRunRow,
  collaborationRoomRunsTable,
  collaborationRoomsTable,
  type CollaborationWorkspaceRow,
  collaborationWorkspacesTable
} from '../database/schema'

const logger = loggerService.withContext('CollaborationService')
const nowIso = () => new Date().toISOString()

export type CreateCollaborationWorkspaceInput = {
  name: string
  description?: string
  rootPaths?: string[]
  routerAgentId?: string
  metadata?: Record<string, unknown>
}

export type UpdateCollaborationWorkspaceInput = Partial<CreateCollaborationWorkspaceInput>

export type CreateCollaborationRoomInput = {
  workspaceId: string
  title: string
  description?: string
  status?: CollaborationRoomRow['status']
  assignedAgentId?: string
  metadata?: Record<string, unknown>
}

export type UpdateCollaborationRoomInput = Partial<Omit<CreateCollaborationRoomInput, 'workspaceId'>>

export type CreateCollaborationRoomMemberInput = {
  roomId: string
  memberType: CollaborationRoomMemberRow['memberType']
  memberId: string
  role?: CollaborationRoomMemberRow['role']
  displayName?: string
  metadata?: Record<string, unknown>
}

export type CreateCollaborationRoomMessageInput = {
  roomId: string
  authorType: CollaborationRoomMessageRow['authorType']
  authorId?: string
  kind?: CollaborationRoomMessageRow['kind']
  intent?: CollaborationRoomMessageRow['intent']
  routing?: CollaborationRoomMessageRow['routing']
  parentMessageId?: string
  content: string
  metadata?: Record<string, unknown>
}

export type UpdateCollaborationRoomMessageInput = Partial<
  Pick<CreateCollaborationRoomMessageInput, 'content' | 'metadata' | 'kind' | 'intent' | 'routing'>
>

export type CreateCollaborationRoomRunInput = {
  roomId: string
  workerAgentId: string
  triggerMessageId?: string
  sessionId?: string
  status?: CollaborationRoomRunRow['status']
  commandSnapshot?: string
  argsSnapshot?: string[]
  summary?: string
  result?: string
  error?: string
}

export type UpdateCollaborationRoomRunInput = Partial<Omit<CreateCollaborationRoomRunInput, 'roomId' | 'workerAgentId'>>

export type CollaborationRoomAutonomyConfig = {
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

export type CollaborationRoomRecord = CollaborationRoomRow & {
  autonomy: CollaborationRoomAutonomyConfig
}

type AutonomyResultStatus = NonNullable<CollaborationRoomAutonomyConfig['lastResult']>['status']

const AUTONOMY_RESULT_STATUSES: AutonomyResultStatus[] = [
  'idle',
  'running',
  'completed',
  'failed',
  'cancelled',
  'no_op'
]

export class CollaborationService extends BaseService {
  private static instance: CollaborationService | null = null

  static getInstance(): CollaborationService {
    if (!CollaborationService.instance) {
      CollaborationService.instance = new CollaborationService()
    }
    return CollaborationService.instance
  }

  async createWorkspace(input: CreateCollaborationWorkspaceInput): Promise<CollaborationWorkspaceRow> {
    const database = await this.getDatabase()
    const id = randomUUID()
    const timestamp = nowIso()
    const rootPaths = this.ensurePathsExist(input.rootPaths)

    await database.insert(collaborationWorkspacesTable).values({
      id,
      name: input.name,
      description: input.description,
      rootPaths,
      routerAgentId: input.routerAgentId,
      metadata: input.metadata,
      createdAt: timestamp,
      updatedAt: timestamp
    })

    logger.info('Created collaboration workspace', { workspaceId: id, name: input.name })
    return this.getWorkspaceOrThrow(id)
  }

  async listWorkspaces(): Promise<CollaborationWorkspaceRow[]> {
    const database = await this.getDatabase()
    return database.select().from(collaborationWorkspacesTable).orderBy(asc(collaborationWorkspacesTable.name))
  }

  async getWorkspace(id: string): Promise<CollaborationWorkspaceRow | null> {
    const database = await this.getDatabase()
    const rows = await database
      .select()
      .from(collaborationWorkspacesTable)
      .where(eq(collaborationWorkspacesTable.id, id))
      .limit(1)
    return rows[0] ?? null
  }

  async updateWorkspace(
    id: string,
    input: UpdateCollaborationWorkspaceInput
  ): Promise<CollaborationWorkspaceRow | null> {
    const database = await this.getDatabase()
    const patch: Partial<typeof collaborationWorkspacesTable.$inferInsert> = {
      updatedAt: nowIso()
    }

    if (input.name !== undefined) patch.name = input.name
    if (input.description !== undefined) patch.description = input.description
    if (input.rootPaths !== undefined) patch.rootPaths = this.ensurePathsExist(input.rootPaths)
    if (input.routerAgentId !== undefined) patch.routerAgentId = input.routerAgentId
    if (input.metadata !== undefined) patch.metadata = input.metadata

    await database.update(collaborationWorkspacesTable).set(patch).where(eq(collaborationWorkspacesTable.id, id))
    return this.getWorkspace(id)
  }

  async createRoom(input: CreateCollaborationRoomInput): Promise<CollaborationRoomRecord> {
    const database = await this.getDatabase()
    const id = randomUUID()
    const timestamp = nowIso()

    await database.insert(collaborationRoomsTable).values({
      id,
      workspaceId: input.workspaceId,
      title: input.title,
      description: input.description,
      status: input.status ?? 'todo',
      assignedAgentId: input.assignedAgentId,
      metadata: input.metadata,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastActivityAt: timestamp
    })

    logger.info('Created collaboration room', { roomId: id, workspaceId: input.workspaceId, title: input.title })
    return this.getRoomOrThrow(id)
  }

  async listRooms(workspaceId: string): Promise<CollaborationRoomRecord[]> {
    const database = await this.getDatabase()
    const rows = await database
      .select()
      .from(collaborationRoomsTable)
      .where(eq(collaborationRoomsTable.workspaceId, workspaceId))
      .orderBy(desc(collaborationRoomsTable.lastActivityAt))
    return rows.filter((row) => !this.isRoomArchived(row.metadata)).map((row) => this.withRoomAutonomy(row))
  }

  async listAllRooms(): Promise<CollaborationRoomRecord[]> {
    const database = await this.getDatabase()
    const rows = await database
      .select()
      .from(collaborationRoomsTable)
      .orderBy(desc(collaborationRoomsTable.lastActivityAt))
    return rows.filter((row) => !this.isRoomArchived(row.metadata)).map((row) => this.withRoomAutonomy(row))
  }

  async getRoom(id: string): Promise<CollaborationRoomRecord | null> {
    const database = await this.getDatabase()
    const rows = await database
      .select()
      .from(collaborationRoomsTable)
      .where(eq(collaborationRoomsTable.id, id))
      .limit(1)
    return rows[0] ? this.withRoomAutonomy(rows[0]) : null
  }

  async updateRoom(id: string, input: UpdateCollaborationRoomInput): Promise<CollaborationRoomRecord | null> {
    const database = await this.getDatabase()
    const patch: Partial<typeof collaborationRoomsTable.$inferInsert> = {
      updatedAt: nowIso()
    }

    if (input.title !== undefined) patch.title = input.title
    if (input.description !== undefined) patch.description = input.description
    if (input.status !== undefined) patch.status = input.status
    if (input.assignedAgentId !== undefined) patch.assignedAgentId = input.assignedAgentId
    if (input.metadata !== undefined) patch.metadata = input.metadata

    await database.update(collaborationRoomsTable).set(patch).where(eq(collaborationRoomsTable.id, id))
    return this.getRoom(id)
  }

  async archiveRoom(id: string): Promise<CollaborationRoomRecord | null> {
    const room = await this.getRoom(id)
    if (!room) return null

    const metadata = this.getRoomMetadata(room.metadata)
    metadata.archivedAt = nowIso()
    delete metadata.startupFreshSession

    return this.updateRoom(id, { metadata })
  }

  async updateRoomAutonomy(
    roomId: string,
    patch: Partial<
      Pick<
        CollaborationRoomAutonomyConfig,
        'enabled' | 'idleMinutes' | 'paused' | 'routerAgentId' | 'lastTriggeredAt' | 'lastResult'
      >
    >
  ): Promise<CollaborationRoomRecord | null> {
    const room = await this.getRoom(roomId)
    if (!room) return null

    const metadata = this.getRoomMetadata(room.metadata)
    metadata.autonomy = {
      ...room.autonomy,
      ...patch,
      enabled: patch.enabled ?? room.autonomy.enabled,
      idleMinutes: patch.idleMinutes ?? room.autonomy.idleMinutes,
      paused: patch.paused ?? room.autonomy.paused
    }

    return this.updateRoom(roomId, { metadata })
  }

  async addRoomMember(input: CreateCollaborationRoomMemberInput): Promise<CollaborationRoomMemberRow> {
    const database = await this.getDatabase()
    const timestamp = nowIso()

    await database
      .insert(collaborationRoomMembersTable)
      .values({
        roomId: input.roomId,
        memberType: input.memberType,
        memberId: input.memberId,
        role: input.role ?? 'participant',
        displayName: input.displayName,
        metadata: input.metadata,
        joinedAt: timestamp,
        updatedAt: timestamp
      })
      .onConflictDoUpdate({
        target: [
          collaborationRoomMembersTable.roomId,
          collaborationRoomMembersTable.memberType,
          collaborationRoomMembersTable.memberId
        ],
        set: {
          role: input.role ?? 'participant',
          displayName: input.displayName,
          metadata: input.metadata,
          updatedAt: timestamp
        }
      })

    const member = await this.getRoomMember(input.roomId, input.memberType, input.memberId)
    if (!member) throw new Error('Failed to load collaboration room member after upsert')
    await this.touchRoom(input.roomId, timestamp)
    return member
  }

  async listRoomMembers(roomId: string): Promise<CollaborationRoomMemberRow[]> {
    const database = await this.getDatabase()
    return database
      .select()
      .from(collaborationRoomMembersTable)
      .where(eq(collaborationRoomMembersTable.roomId, roomId))
      .orderBy(asc(collaborationRoomMembersTable.role), asc(collaborationRoomMembersTable.joinedAt))
  }

  async removeRoomMember(
    roomId: string,
    memberType: CollaborationRoomMemberRow['memberType'],
    memberId: string
  ): Promise<boolean> {
    const database = await this.getDatabase()
    const result = await database
      .delete(collaborationRoomMembersTable)
      .where(
        and(
          eq(collaborationRoomMembersTable.roomId, roomId),
          eq(collaborationRoomMembersTable.memberType, memberType),
          eq(collaborationRoomMembersTable.memberId, memberId)
        )
      )
    if (result.rowsAffected > 0) {
      await this.touchRoom(roomId)
      return true
    }
    return false
  }

  async createRoomMessage(input: CreateCollaborationRoomMessageInput): Promise<CollaborationRoomMessageRow> {
    const database = await this.getDatabase()
    const id = randomUUID()
    const timestamp = nowIso()

    await database.insert(collaborationRoomMessagesTable).values({
      id,
      roomId: input.roomId,
      authorType: input.authorType,
      authorId: input.authorId,
      kind: input.kind ?? (input.intent === 'task' ? 'task' : 'message'),
      intent: input.intent ?? 'message',
      routing: input.routing ?? 'none',
      parentMessageId: input.parentMessageId,
      content: input.content,
      metadata: input.metadata,
      createdAt: timestamp,
      updatedAt: timestamp
    })

    await database
      .update(collaborationRoomsTable)
      .set({ updatedAt: timestamp, lastActivityAt: timestamp })
      .where(eq(collaborationRoomsTable.id, input.roomId))

    const message = await this.getRoomMessage(id)
    if (!message) throw new Error('Failed to load collaboration room message after insert')
    return message
  }

  async listRoomMessages(roomId: string): Promise<CollaborationRoomMessageRow[]> {
    const database = await this.getDatabase()
    return database
      .select()
      .from(collaborationRoomMessagesTable)
      .where(eq(collaborationRoomMessagesTable.roomId, roomId))
      .orderBy(asc(collaborationRoomMessagesTable.createdAt))
  }

  async getRoomMessage(id: string): Promise<CollaborationRoomMessageRow | null> {
    const database = await this.getDatabase()
    const rows = await database
      .select()
      .from(collaborationRoomMessagesTable)
      .where(eq(collaborationRoomMessagesTable.id, id))
      .limit(1)
    return rows[0] ?? null
  }

  async updateRoomMessage(
    id: string,
    input: UpdateCollaborationRoomMessageInput
  ): Promise<CollaborationRoomMessageRow | null> {
    const existing = await this.getRoomMessage(id)
    if (!existing) return null
    const database = await this.getDatabase()
    const timestamp = nowIso()
    await database
      .update(collaborationRoomMessagesTable)
      .set({
        content: input.content ?? existing.content,
        metadata: input.metadata ?? existing.metadata,
        kind: input.kind ?? existing.kind,
        intent: input.intent ?? existing.intent,
        routing: input.routing ?? existing.routing,
        updatedAt: timestamp
      })
      .where(eq(collaborationRoomMessagesTable.id, id))

    await this.touchRoom(existing.roomId, timestamp)
    return this.getRoomMessage(id)
  }

  async createRoomRun(input: CreateCollaborationRoomRunInput): Promise<CollaborationRoomRunRow> {
    const database = await this.getDatabase()
    const id = randomUUID()
    const timestamp = nowIso()

    await database.insert(collaborationRoomRunsTable).values({
      id,
      roomId: input.roomId,
      workerAgentId: input.workerAgentId,
      triggerMessageId: input.triggerMessageId,
      sessionId: input.sessionId,
      status: input.status ?? 'queued',
      commandSnapshot: input.commandSnapshot,
      argsSnapshot: input.argsSnapshot,
      summary: input.summary,
      result: input.result,
      error: input.error,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: input.status === 'running' ? timestamp : undefined,
      completedAt:
        input.status === 'completed' || input.status === 'failed' || input.status === 'cancelled'
          ? timestamp
          : undefined
    })
    await this.touchRoom(input.roomId, timestamp)

    const run = await this.getRoomRun(id)
    if (!run) throw new Error('Failed to load collaboration room run after insert')
    return run
  }

  async listRoomRuns(roomId: string): Promise<CollaborationRoomRunRow[]> {
    const database = await this.getDatabase()
    return database
      .select()
      .from(collaborationRoomRunsTable)
      .where(eq(collaborationRoomRunsTable.roomId, roomId))
      .orderBy(desc(collaborationRoomRunsTable.createdAt))
  }

  async getRoomRun(id: string): Promise<CollaborationRoomRunRow | null> {
    const database = await this.getDatabase()
    const rows = await database
      .select()
      .from(collaborationRoomRunsTable)
      .where(eq(collaborationRoomRunsTable.id, id))
      .limit(1)
    return rows[0] ?? null
  }

  async updateRoomRun(id: string, input: UpdateCollaborationRoomRunInput): Promise<CollaborationRoomRunRow | null> {
    const database = await this.getDatabase()
    const existing = await this.getRoomRun(id)
    if (!existing) return null
    const patch: Partial<typeof collaborationRoomRunsTable.$inferInsert> = {
      updatedAt: nowIso()
    }

    if (input.triggerMessageId !== undefined) patch.triggerMessageId = input.triggerMessageId
    if (input.sessionId !== undefined) patch.sessionId = input.sessionId
    if (input.status !== undefined) {
      patch.status = input.status
      if (input.status === 'running' && patch.startedAt === undefined) {
        patch.startedAt = nowIso()
      }
      if (['completed', 'failed', 'cancelled'].includes(input.status)) {
        patch.completedAt = nowIso()
      }
    }
    if (input.commandSnapshot !== undefined) patch.commandSnapshot = input.commandSnapshot
    if (input.argsSnapshot !== undefined) patch.argsSnapshot = input.argsSnapshot
    if (input.summary !== undefined) patch.summary = input.summary
    if (input.result !== undefined) patch.result = input.result
    if (input.error !== undefined) patch.error = input.error

    await database.update(collaborationRoomRunsTable).set(patch).where(eq(collaborationRoomRunsTable.id, id))
    await this.touchRoom(existing.roomId, patch.updatedAt)
    return this.getRoomRun(id)
  }

  private async getWorkspaceOrThrow(id: string): Promise<CollaborationWorkspaceRow> {
    const workspace = await this.getWorkspace(id)
    if (!workspace) throw new Error(`Collaboration workspace ${id} was not found after insert`)
    return workspace
  }

  private async getRoomOrThrow(id: string): Promise<CollaborationRoomRecord> {
    const room = await this.getRoom(id)
    if (!room) throw new Error(`Collaboration room ${id} was not found after insert`)
    return room
  }

  private withRoomAutonomy(room: CollaborationRoomRow): CollaborationRoomRecord {
    return {
      ...room,
      autonomy: this.parseRoomAutonomy(room.metadata)
    }
  }

  private getRoomMetadata(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> {
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? { ...metadata } : {}
  }

  private parseRoomAutonomy(metadata: Record<string, unknown> | null | undefined): CollaborationRoomAutonomyConfig {
    const autonomySource = this.getRoomMetadata(metadata).autonomy
    const autonomy =
      autonomySource && typeof autonomySource === 'object' && !Array.isArray(autonomySource)
        ? (autonomySource as Record<string, unknown>)
        : {}

    const lastResultSource = autonomy.lastResult
    const lastResultRecord =
      lastResultSource && typeof lastResultSource === 'object' && !Array.isArray(lastResultSource)
        ? (lastResultSource as Record<string, unknown>)
        : null
    const status =
      typeof lastResultRecord?.status === 'string' &&
      AUTONOMY_RESULT_STATUSES.includes(lastResultRecord.status as AutonomyResultStatus)
        ? (lastResultRecord.status as AutonomyResultStatus)
        : 'idle'
    const source: 'manual' | 'idle' = lastResultRecord?.source === 'idle' ? 'idle' : 'manual'
    const lastResult = lastResultRecord
      ? {
          status,
          summary: typeof lastResultRecord.summary === 'string' ? lastResultRecord.summary : '',
          source,
          at: typeof lastResultRecord.at === 'string' ? lastResultRecord.at : nowIso(),
          runId: typeof lastResultRecord.runId === 'string' ? lastResultRecord.runId : undefined
        }
      : undefined

    return {
      enabled: autonomy.enabled === true,
      idleMinutes: typeof autonomy.idleMinutes === 'number' ? autonomy.idleMinutes : 30,
      paused: autonomy.paused === true,
      routerAgentId: typeof autonomy.routerAgentId === 'string' ? autonomy.routerAgentId : undefined,
      lastTriggeredAt: typeof autonomy.lastTriggeredAt === 'string' ? autonomy.lastTriggeredAt : undefined,
      lastResult
    }
  }

  private isRoomArchived(metadata: Record<string, unknown> | null | undefined): boolean {
    const roomMetadata = this.getRoomMetadata(metadata)
    return typeof roomMetadata.archivedAt === 'string' && roomMetadata.archivedAt.length > 0
  }

  private async touchRoom(roomId: string, timestamp = nowIso()): Promise<void> {
    const database = await this.getDatabase()
    await database
      .update(collaborationRoomsTable)
      .set({ updatedAt: timestamp, lastActivityAt: timestamp })
      .where(eq(collaborationRoomsTable.id, roomId))
  }

  private async getRoomMember(
    roomId: string,
    memberType: CollaborationRoomMemberRow['memberType'],
    memberId: string
  ): Promise<CollaborationRoomMemberRow | null> {
    const database = await this.getDatabase()
    const rows = await database
      .select()
      .from(collaborationRoomMembersTable)
      .where(
        and(
          eq(collaborationRoomMembersTable.roomId, roomId),
          eq(collaborationRoomMembersTable.memberType, memberType),
          eq(collaborationRoomMembersTable.memberId, memberId)
        )
      )
      .limit(1)
    return rows[0] ?? null
  }
}

export const collaborationService = CollaborationService.getInstance()
