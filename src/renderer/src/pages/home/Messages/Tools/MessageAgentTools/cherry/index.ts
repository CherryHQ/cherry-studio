/**
 * Cherry-builtin tool renderer dispatch table.
 *
 * Parallel to `toolRenderers` keyed on `AgentToolsType` (Claude Agent
 * SDK names) — this one keys on cherry's own builtin tool names
 * (`fs__read`, `shell__exec`, ...). MessageAgentTools' `ToolContent`
 * checks this first; falls through to AgentToolsType, then
 * UnknownToolRenderer.
 *
 * Phase-out plan: as cherry-shape renderers are added here, the
 * matching `AgentToolsType` slot can be deleted once we stop sending
 * the Claude Agent SDK input shape on that channel.
 */

import type { CollapseProps } from 'antd'

import { FsPatchTool } from './FsPatchTool'
import { FsReadTool } from './FsReadTool'
import { ShellExecTool } from './ShellExecTool'

type ToolItem = NonNullable<CollapseProps['items']>[number]

export type CherryToolRenderer = (props: { input?: Record<string, unknown>; output?: unknown }) => ToolItem

export const cherryToolRenderers: Record<string, CherryToolRenderer> = {
  fs__read: FsReadTool as CherryToolRenderer,
  fs__patch: FsPatchTool as CherryToolRenderer,
  shell__exec: ShellExecTool as CherryToolRenderer
}

export function isCherryBuiltinTool(toolName: string): boolean {
  return toolName in cherryToolRenderers
}
