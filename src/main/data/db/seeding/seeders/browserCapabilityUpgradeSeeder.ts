import { and, eq, inArray } from 'drizzle-orm'

import { agentTable } from '@data/db/schemas/agent'
import { assistantTable } from '@data/db/schemas/assistant'
import { agentMcpServerTable, assistantMcpServerTable } from '@data/db/schemas/assistantRelations'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { BROWSER_TOOL_GROUP } from '@shared/ai/browserTools'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'

import type { DbType, ISeeder } from '../../types'

export class BrowserCapabilityUpgradeSeeder implements ISeeder {
  readonly name = 'browserCapabilityUpgrade'
  readonly description = 'Move legacy browser bindings to conversation browser capabilities'
  readonly version = '1'

  run(db: DbType): void {
    const servers = db
      .select()
      .from(mcpServerTable)
      .where(and(eq(mcpServerTable.type, 'inMemory'), eq(mcpServerTable.name, BuiltinMcpServerNames.browser)))
      .all()
    if (!servers.length) return
    const ids = servers.map((server) => server.id)
    const restricted = new Set(
      servers
        .filter((server) => !server.isActive || server.disabledTools?.length || server.disabledAutoApproveTools?.length)
        .map((server) => server.id)
    )
    db.transaction((tx) => {
      const assistantLinks = tx
        .select()
        .from(assistantMcpServerTable)
        .where(inArray(assistantMcpServerTable.mcpServerId, ids))
        .all()
      for (const assistant of tx.select().from(assistantTable).all()) {
        if (assistant.settings.enableBrowser !== undefined) continue
        const linked = assistantLinks.filter((link) => link.assistantId === assistant.id)
        if (!linked.length && assistant.settings.mcpMode !== 'auto') continue
        const enabled =
          assistant.settings.mcpMode !== 'disabled' &&
          (assistant.settings.mcpMode === 'auto'
            ? restricted.size === 0
            : linked.every((link) => !restricted.has(link.mcpServerId)))
        tx.update(assistantTable)
          .set({ settings: { ...assistant.settings, enableBrowser: enabled } })
          .where(eq(assistantTable.id, assistant.id))
          .run()
      }
      const agentLinks = tx
        .select()
        .from(agentMcpServerTable)
        .where(inArray(agentMcpServerTable.mcpServerId, ids))
        .all()
      for (const link of agentLinks) {
        if (!restricted.has(link.mcpServerId)) continue
        const agent = tx.select().from(agentTable).where(eq(agentTable.id, link.agentId)).get()
        if (!agent || agent.disabledTools.includes(BROWSER_TOOL_GROUP)) continue
        tx.update(agentTable)
          .set({ disabledTools: [...agent.disabledTools, BROWSER_TOOL_GROUP] })
          .where(eq(agentTable.id, agent.id))
          .run()
      }
      tx.delete(assistantMcpServerTable).where(inArray(assistantMcpServerTable.mcpServerId, ids)).run()
      tx.delete(agentMcpServerTable).where(inArray(agentMcpServerTable.mcpServerId, ids)).run()
      tx.update(mcpServerTable).set({ isActive: false }).where(inArray(mcpServerTable.id, ids)).run()
    })
  }
}
