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
import { createApplyPatchToolEntry } from './fs/applyPatch'
import { createFindGrepToolEntry } from './fs/findGrep'
import { createFindPathToolEntry } from './fs/findPath'
import { createReadFileToolEntry } from './fs/readFile'
import { createKbSearchToolEntry } from './KnowledgeSearchTool'
import { createShellExecToolEntry } from './shell/exec'
import { createWebSearchToolEntry } from './WebSearchTool'

export function registerBuiltinTools(reg: ToolRegistry = registry): void {
  reg.register(createKbSearchToolEntry())
  reg.register(createWebSearchToolEntry())
  reg.register(createReadFileToolEntry())
  reg.register(createApplyPatchToolEntry())
  reg.register(createFindPathToolEntry())
  reg.register(createFindGrepToolEntry())
  reg.register(createShellExecToolEntry())
}
