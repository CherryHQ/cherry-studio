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
import { createKbListToolEntry } from './KnowledgeListTool'
import { createKbSearchToolEntry } from './KnowledgeSearchTool'
import { createWebFetchToolEntry, createWebSearchToolEntry } from './WebSearchTool'

export function registerBuiltinTools(reg: ToolRegistry = registry): void {
  reg.register(createKbListToolEntry())
  reg.register(createKbSearchToolEntry())
  reg.register(createWebFetchToolEntry())
  reg.register(createWebSearchToolEntry())
}
