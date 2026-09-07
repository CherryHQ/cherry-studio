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
import { createFsReadToolEntry } from './FsReadTool'
import { createKbListToolEntry } from './KnowledgeListTool'
import { createKbManageToolEntry } from './KnowledgeManageTool'
import { createKbReadToolEntry } from './KnowledgeReadTool'
import { createKbSearchToolEntry } from './KnowledgeSearchTool'
import { createMcpResourceListToolEntry } from './McpResourceListTool'
import { createMcpResourceReadToolEntry } from './McpResourceReadTool'
import { createGenerateImageToolEntry } from './PaintingTool'
import { createReadFileToolEntry } from './ReadFileTool'
import { createWebFetchToolEntry } from './WebFetchTool'
import { createWebSearchToolEntry } from './WebSearchTool'

export function registerBuiltinTools(reg: ToolRegistry = registry): void {
  // Gated per request (see createFsReadToolEntry), and always confined to the
  // request's persisted-output allow-list — an empty list denies every read.
  reg.register(createFsReadToolEntry())
  reg.register(createKbListToolEntry())
  reg.register(createKbSearchToolEntry())
  reg.register(createKbReadToolEntry())
  reg.register(createKbManageToolEntry())
  reg.register(createMcpResourceListToolEntry())
  reg.register(createMcpResourceReadToolEntry())
  reg.register(createReadFileToolEntry())
  reg.register(createGenerateImageToolEntry())
  reg.register(createWebFetchToolEntry())
  reg.register(createWebSearchToolEntry())
}
