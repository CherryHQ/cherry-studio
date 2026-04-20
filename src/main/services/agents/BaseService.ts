import { application } from '@application'
import type { AgentType, SlashCommand, Tool } from '@types'

import {
  deserializeJsonFields,
  ensurePathsExist,
  ENTITY_TO_ROW_FIELD_MAP,
  JSON_FIELDS,
  listMcpTools,
  listSlashCommands,
  normalizeAllowedTools,
  resolveAccessiblePaths,
  serializeJsonFields,
  validateAgentModels
} from './agentUtils'
import type { AgentModelField } from './errors'

export { ENTITY_TO_ROW_FIELD_MAP }

/**
 * @deprecated Use standalone functions from `agentUtils.ts` and call
 * `application.get('DbService').getDb()` directly. This class remains only
 * to support `AgentMessageRepository` until it is removed in the agents-data-api refactor.
 */
export abstract class BaseService {
  protected jsonFields: string[] = JSON_FIELDS

  public async getDatabase() {
    return application.get('DbService').getDb()
  }

  protected serializeJsonFields(data: any): any {
    return serializeJsonFields(data, this.jsonFields)
  }

  protected deserializeJsonFields(data: any): any {
    return deserializeJsonFields(data, this.jsonFields)
  }

  protected ensurePathsExist(paths?: string[]): string[] {
    return ensurePathsExist(paths)
  }

  protected resolveAccessiblePaths(paths: string[] | undefined, id: string): string[] {
    return resolveAccessiblePaths(paths, id)
  }

  protected async validateAgentModels(
    agentType: AgentType,
    models: Partial<Record<AgentModelField, string | undefined>>
  ): Promise<void> {
    return validateAgentModels(agentType, models)
  }

  public async listMcpTools(
    agentType: AgentType,
    ids?: string[]
  ): Promise<{ tools: Tool[]; legacyIdMap: Map<string, string> }> {
    return listMcpTools(agentType, ids)
  }

  protected normalizeAllowedTools(
    allowedTools: string[] | undefined,
    tools: Tool[],
    legacyIdMap?: Map<string, string>
  ): string[] | undefined {
    return normalizeAllowedTools(allowedTools, tools, legacyIdMap)
  }

  public async listSlashCommands(agentType: AgentType): Promise<SlashCommand[]> {
    return listSlashCommands(agentType)
  }
}
