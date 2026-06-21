/**
 * Single registration point for builtin tools.
 *
 * AiService calls `registerBuiltinTools()` from its `onInit` so the registry
 * is populated before any chat request runs. Adding a new builtin tool means
 * importing its entry factory here and pushing one more `reg.register(...)`
 * line — no scattered side-effect imports, no module-load ordering surprises.
 *
 * Tests can pass a fresh `ToolRegistry` to keep the global singleton clean.
 */

import { registry, type ToolRegistry } from '../registry'
import { createKbGrepToolEntry } from './KnowledgeGrepTool'
import { createKbListToolEntry } from './KnowledgeListTool'
import { createKbManageToolEntry } from './KnowledgeManageTool'
import { createKbReadToolEntry } from './KnowledgeReadTool'
import { createKbSearchToolEntry } from './KnowledgeSearchTool'
import { createKbTreeToolEntry } from './KnowledgeTreeTool'
import { createWebFetchToolEntry } from './WebFetchTool'
import { createWebSearchToolEntry } from './WebSearchTool'

export function registerBuiltinTools(reg: ToolRegistry = registry): void {
  reg.register(createKbListToolEntry())
  reg.register(createKbSearchToolEntry())
  reg.register(createKbReadToolEntry())
  reg.register(createKbGrepToolEntry())
  reg.register(createKbTreeToolEntry())
  reg.register(createKbManageToolEntry())
  reg.register(createWebFetchToolEntry())
  reg.register(createWebSearchToolEntry())
}
