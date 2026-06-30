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
import { createKbSearchToolEntry } from './KnowledgeSearchTool'
import { createReadFileToolEntry } from './ReadFileTool'
import { createWebFetchToolEntry } from './WebFetchTool'
import { createWebSearchToolEntry } from './WebSearchTool'

export function registerBuiltinTools(reg: ToolRegistry = registry): void {
  // fs_read is intentionally always registered (no `applies` gate): its containment
  // root is only ever the VfsBlobService temp dir (realpath-confined, read-only,
  // size-capped), and it is inert when truncation is off. The persisted-output
  // system-prompt section is keyed on its presence, so it stays available too.
  reg.register(createFsReadToolEntry())
  reg.register(createKbListToolEntry())
  reg.register(createKbSearchToolEntry())
  reg.register(createReadFileToolEntry())
  reg.register(createWebFetchToolEntry())
  reg.register(createWebSearchToolEntry())
}
