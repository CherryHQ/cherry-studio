import type { ISeeder } from '../types'
import { AgentSessionContextSeeder } from './seeders/AgentSessionContextSeeder'
import { AgentSessionMessageTreeSeeder } from './seeders/AgentSessionMessageTreeSeeder'
import { BrowserCapabilityUpgradeSeeder } from './seeders/browserCapabilityUpgradeSeeder'
import { BuiltinMcpServerSeeder } from './seeders/builtinMcpServerSeeder'
import { CherryAiDefaultModelSeeder } from './seeders/cherryaiDefaultModelSeeder'
import { CherryAssistantInstructionsUpgradeSeeder } from './seeders/CherryAssistantInstructionsUpgradeSeeder'
import { CherryAssistantSeeder } from './seeders/cherryAssistantSeeder'
import { CherrySupportSeeder } from './seeders/cherrySupportSeeder'
import { DefaultAssistantSeeder } from './seeders/defaultAssistantSeeder'
import { ExternalSkillExportUpgradeSeeder } from './seeders/ExternalSkillExportUpgradeSeeder'
import { KnowledgeBaseOrderSeeder } from './seeders/knowledgeBaseOrderSeeder'
import { LegacyFileCleanupPolicySeeder } from './seeders/legacyFileCleanupPolicySeeder'
import { LocalModelSeeder } from './seeders/LocalModelSeeder'
import { LongTextPastePreferenceUpgradeSeeder } from './seeders/longTextPastePreferenceUpgradeSeeder'
import { MessageNavigationUpgradeSeeder } from './seeders/MessageNavigationUpgradeSeeder'
import { MiniAppSeeder } from './seeders/miniAppSeeder'
import { PoeChatEndpointUpgradeSeeder } from './seeders/PoeChatEndpointUpgradeSeeder'
import { PreferenceSeeder } from './seeders/preferenceSeeder'
import { PresetProviderSeeder } from './seeders/presetProviderSeeder'
import { RetiredAgentRuntimeSeeder } from './seeders/RetiredAgentRuntimeSeeder'
import { ScheduledTasksShortcutSeeder } from './seeders/scheduledTasksShortcutSeeder'
import { SelectionActionItemsUpgradeSeeder } from './seeders/selectionActionItemsUpgradeSeeder'
import { SidebarShortcutMigrationSeeder } from './seeders/sidebarShortcutMigrationSeeder'
import { TranslateLanguageSeeder } from './seeders/translateLanguageSeeder'
import { WebSearchPreferenceUpgradeSeeder } from './seeders/WebSearchPreferenceUpgradeSeeder'

/**
 * All seeders in execution order.
 *
 * Keep CherryAiDefaultModelSeeder before DefaultAssistantSeeder because the
 * seeded assistant references the CherryAI default model (FK to user_model).
 *
 * To add a new seeder: create an ISeeder class, add it to this array.
 * No changes to DbService needed.
 */
export const seeders: ISeeder[] = [
  new ExternalSkillExportUpgradeSeeder(),
  new RetiredAgentRuntimeSeeder(),
  new AgentSessionContextSeeder(),
  new AgentSessionMessageTreeSeeder(),
  new KnowledgeBaseOrderSeeder(),
  new BrowserCapabilityUpgradeSeeder(),
  new LegacyFileCleanupPolicySeeder(),
  new PresetProviderSeeder(),
  new PoeChatEndpointUpgradeSeeder(),
  new CherryAiDefaultModelSeeder(),
  new CherryAssistantSeeder(),
  new CherryAssistantInstructionsUpgradeSeeder(),
  new CherrySupportSeeder(),
  new DefaultAssistantSeeder(),
  new LongTextPastePreferenceUpgradeSeeder(),
  new WebSearchPreferenceUpgradeSeeder(),
  new SidebarShortcutMigrationSeeder(),
  new ScheduledTasksShortcutSeeder(),
  new SelectionActionItemsUpgradeSeeder(),
  new MessageNavigationUpgradeSeeder(),
  new PreferenceSeeder(),
  new TranslateLanguageSeeder(),
  new LocalModelSeeder(),
  new MiniAppSeeder(),
  new BuiltinMcpServerSeeder()
]
