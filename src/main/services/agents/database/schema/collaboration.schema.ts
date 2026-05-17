/**
 * Drizzle ORM schema for collaboration workspaces, rooms, room members, messages, and runs.
 */

import { sql } from 'drizzle-orm'
import { check, index, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { v4 as uuidv4 } from 'uuid'

import { agentsTable } from './agents.schema'
import { sessionsTable } from './sessions.schema'

const isoTimestamp = () => new Date().toISOString()

export const collaborationWorkspacesTable = sqliteTable(
  'collaboration_workspaces',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => uuidv4()),
    name: text('name').notNull(),
    description: text('description'),
    rootPaths: text('root_paths', { mode: 'json' }).$type<string[]>().notNull().default([]),
    routerAgentId: text('router_agent_id').references(() => agentsTable.id, { onDelete: 'set null' }),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => isoTimestamp()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => isoTimestamp())
      .$onUpdateFn(() => isoTimestamp())
  },
  (t) => [
    index('collab_workspaces_name_idx').on(t.name),
    index('collab_workspaces_router_agent_idx').on(t.routerAgentId)
  ]
)

export const collaborationRoomsTable = sqliteTable(
  'collaboration_rooms',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => uuidv4()),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => collaborationWorkspacesTable.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').notNull().default('todo'),
    assignedAgentId: text('assigned_agent_id').references(() => agentsTable.id, { onDelete: 'set null' }),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => isoTimestamp()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => isoTimestamp())
      .$onUpdateFn(() => isoTimestamp()),
    lastActivityAt: text('last_activity_at')
      .notNull()
      .$defaultFn(() => isoTimestamp())
  },
  (t) => [
    index('collab_rooms_workspace_idx').on(t.workspaceId),
    index('collab_rooms_status_idx').on(t.status),
    index('collab_rooms_assigned_agent_idx').on(t.assignedAgentId),
    index('collab_rooms_last_activity_idx').on(t.lastActivityAt),
    check(
      'collab_rooms_status_check',
      sql`${t.status} IN ('todo', 'in_progress', 'needs_confirmation', 'done', 'blocked')`
    )
  ]
)

export const collaborationRoomMembersTable = sqliteTable(
  'collaboration_room_members',
  {
    roomId: text('room_id')
      .notNull()
      .references(() => collaborationRoomsTable.id, { onDelete: 'cascade' }),
    memberType: text('member_type').notNull(),
    memberId: text('member_id').notNull(),
    role: text('role').notNull().default('participant'),
    displayName: text('display_name'),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    joinedAt: text('joined_at')
      .notNull()
      .$defaultFn(() => isoTimestamp()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => isoTimestamp())
      .$onUpdateFn(() => isoTimestamp())
  },
  (t) => [
    primaryKey({ columns: [t.roomId, t.memberType, t.memberId] }),
    index('collab_room_members_member_idx').on(t.memberType, t.memberId),
    check('collab_room_members_type_check', sql`${t.memberType} IN ('user', 'agent')`),
    check('collab_room_members_role_check', sql`${t.role} IN ('owner', 'participant')`)
  ]
)

export const collaborationRoomMessagesTable = sqliteTable(
  'collaboration_room_messages',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => uuidv4()),
    roomId: text('room_id')
      .notNull()
      .references(() => collaborationRoomsTable.id, { onDelete: 'cascade' }),
    authorType: text('author_type').notNull(),
    authorId: text('author_id'),
    kind: text('kind').notNull().default('message'),
    intent: text('intent').notNull().default('message'),
    routing: text('routing').notNull().default('none'),
    parentMessageId: text('parent_message_id'),
    content: text('content').notNull(),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => isoTimestamp()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => isoTimestamp())
      .$onUpdateFn(() => isoTimestamp())
  },
  (t) => [
    index('collab_room_messages_room_idx').on(t.roomId, t.createdAt),
    index('collab_room_messages_parent_idx').on(t.parentMessageId),
    index('collab_room_messages_intent_idx').on(t.intent),
    check('collab_room_messages_author_type_check', sql`${t.authorType} IN ('user', 'agent', 'system')`),
    check('collab_room_messages_kind_check', sql`${t.kind} IN ('message', 'task', 'event')`),
    check('collab_room_messages_intent_check', sql`${t.intent} IN ('message', 'task')`),
    check('collab_room_messages_routing_check', sql`${t.routing} IN ('none', 'elite')`)
  ]
)

export const collaborationRoomRunsTable = sqliteTable(
  'collaboration_room_runs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => uuidv4()),
    roomId: text('room_id')
      .notNull()
      .references(() => collaborationRoomsTable.id, { onDelete: 'cascade' }),
    workerAgentId: text('worker_agent_id')
      .notNull()
      .references(() => agentsTable.id, { onDelete: 'cascade' }),
    triggerMessageId: text('trigger_message_id').references(() => collaborationRoomMessagesTable.id, {
      onDelete: 'set null'
    }),
    sessionId: text('session_id').references(() => sessionsTable.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('queued'),
    commandSnapshot: text('command_snapshot'),
    argsSnapshot: text('args_snapshot', { mode: 'json' }).$type<string[]>(),
    summary: text('summary'),
    result: text('result'),
    error: text('error'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => isoTimestamp()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => isoTimestamp())
      .$onUpdateFn(() => isoTimestamp()),
    startedAt: text('started_at'),
    completedAt: text('completed_at')
  },
  (t) => [
    index('collab_room_runs_room_idx').on(t.roomId, t.createdAt),
    index('collab_room_runs_worker_idx').on(t.workerAgentId, t.createdAt),
    index('collab_room_runs_status_idx').on(t.status),
    check(
      'collab_room_runs_status_check',
      sql`${t.status} IN ('queued', 'running', 'completed', 'failed', 'cancelled')`
    )
  ]
)

export type CollaborationWorkspaceRow = typeof collaborationWorkspacesTable.$inferSelect
export type InsertCollaborationWorkspaceRow = typeof collaborationWorkspacesTable.$inferInsert
export type CollaborationRoomRow = typeof collaborationRoomsTable.$inferSelect
export type InsertCollaborationRoomRow = typeof collaborationRoomsTable.$inferInsert
export type CollaborationRoomMemberRow = typeof collaborationRoomMembersTable.$inferSelect
export type InsertCollaborationRoomMemberRow = typeof collaborationRoomMembersTable.$inferInsert
export type CollaborationRoomMessageRow = typeof collaborationRoomMessagesTable.$inferSelect
export type InsertCollaborationRoomMessageRow = typeof collaborationRoomMessagesTable.$inferInsert
export type CollaborationRoomRunRow = typeof collaborationRoomRunsTable.$inferSelect
export type InsertCollaborationRoomRunRow = typeof collaborationRoomRunsTable.$inferInsert
