import { agentTable } from '@data/db/schemas/agent'
import { agentChannelTable, agentChannelTaskTable } from '@data/db/schemas/agentChannel'
import { agentGlobalSkillTable } from '@data/db/schemas/agentGlobalSkill'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentSkillTable } from '@data/db/schemas/agentSkill'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { appStateTable } from '@data/db/schemas/appState'
import { assistantTable } from '@data/db/schemas/assistant'
import {
  agentMcpServerTable,
  assistantKnowledgeBaseTable,
  assistantMcpServerTable
} from '@data/db/schemas/assistantRelations'
import { fileEntryTable } from '@data/db/schemas/file'
import {
  chatMessageFileRefTable,
  miniAppLogoFileRefTable,
  paintingFileRefTable,
  providerLogoFileRefTable
} from '@data/db/schemas/fileRelations'
import { jobScheduleTable } from '@data/db/schemas/job'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { messageTable } from '@data/db/schemas/message'
import { miniAppTable } from '@data/db/schemas/miniApp'
import { noteTable } from '@data/db/schemas/note'
import { paintingTable } from '@data/db/schemas/painting'
import { pinTable } from '@data/db/schemas/pin'
import { preferenceTable } from '@data/db/schemas/preference'
import { promptTable } from '@data/db/schemas/prompt'
import { entityTagTable, tagTable } from '@data/db/schemas/tagging'
import { topicTable } from '@data/db/schemas/topic'
import { translateHistoryTable } from '@data/db/schemas/translateHistory'
import { translateLanguageTable } from '@data/db/schemas/translateLanguage'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { getTableColumns, getTableName } from 'drizzle-orm'
import { CasingCache } from 'drizzle-orm/casing'
import type { AnySQLiteTable } from 'drizzle-orm/sqlite-core'

// Must match the casing configured by DbService and MigrationDbService.
const physicalNames = new CasingCache('snake_case')

function defineTarget<const TRole extends string>(role: TRole, table: AnySQLiteTable) {
  return Object.freeze({
    role,
    table: getTableName(table),
    columns: Object.freeze(Object.values(getTableColumns(table)).map((column) => physicalNames.getColumnCasing(column)))
  })
}

export const MIGRATION_DATABASE_OBJECT_DEFINITIONS = Object.freeze([
  defineTarget('app_state', appStateTable),
  defineTarget('preference', preferenceTable),
  defineTarget('note', noteTable),
  defineTarget('mini_app', miniAppTable),
  defineTarget('mcp_server', mcpServerTable),
  defineTarget('user_provider', userProviderTable),
  defineTarget('user_model', userModelTable),
  defineTarget('assistant', assistantTable),
  defineTarget('assistant_mcp_server', assistantMcpServerTable),
  defineTarget('assistant_knowledge_base', assistantKnowledgeBaseTable),
  defineTarget('tag', tagTable),
  defineTarget('entity_tag', entityTagTable),
  defineTarget('file', fileEntryTable),
  defineTarget('provider_logo_file_ref', providerLogoFileRefTable),
  defineTarget('mini_app_logo_file_ref', miniAppLogoFileRefTable),
  defineTarget('agent', agentTable),
  defineTarget('agent_session', agentSessionTable),
  defineTarget('agent_workspace', agentWorkspaceTable),
  defineTarget('agent_global_skill', agentGlobalSkillTable),
  defineTarget('agent_skill', agentSkillTable),
  defineTarget('agent_channel', agentChannelTable),
  defineTarget('agent_session_message', agentSessionMessageTable),
  defineTarget('job_schedule', jobScheduleTable),
  defineTarget('agent_channel_task', agentChannelTaskTable),
  defineTarget('agent_mcp_server', agentMcpServerTable),
  defineTarget('knowledge_base', knowledgeBaseTable),
  defineTarget('knowledge_item', knowledgeItemTable),
  defineTarget('topic', topicTable),
  defineTarget('message', messageTable),
  defineTarget('chat_message_file_ref', chatMessageFileRefTable),
  defineTarget('pin', pinTable),
  defineTarget('painting', paintingTable),
  defineTarget('painting_file_ref', paintingFileRefTable),
  defineTarget('translate_language', translateLanguageTable),
  defineTarget('translate_history', translateHistoryTable),
  defineTarget('prompt', promptTable)
] as const)
