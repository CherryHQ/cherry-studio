/**
 * Single declarative source of truth for Claude Code agent tools.
 *
 * Each tool declares its own metadata, its dependencies, and (optionally) a predicate for when it
 * is enabled. The allowed/disallowed set for a session is *derived* from those declarations plus a
 * runtime context — there are no side tables of tool-name relationships. This drives backend policy
 * (which tools are blocked / the canUseTool catalog) and the edit-dialog catalog UI.
 *
 * Migration in progress: this is intended to replace the hand-maintained lists in `builtinTools.ts`
 * and the renderer's tool metadata, which still coexist until those call sites are ported.
 */

import type { ClaudeToolDescriptor } from './toolRules'

export type ClaudeToolCategory = 'shell' | 'file' | 'search' | 'orchestration' | 'media' | 'context'

/**
 * Tool visibility / availability policy:
 * - `user`     shown in the edit dialog, user toggles enable/disable
 * - `internal` always enabled, hidden from the UI
 * - `disabled` always blocked (added to the SDK `disallowedTools` hard-block list)
 *
 * Orthogonal to exposure, a tool may declare `dependsOn` (other tools it requires) here, and a
 * runtime enable-predicate in main (`src/main/ai/tools/adapters/claudeCode/toolConditions.ts`).
 * Both can additionally disable it — see `resolveDisallowedTools` there.
 */
export type ClaudeToolExposure = 'user' | 'internal' | 'disabled'

export interface ClaudeToolDescriptorDef {
  /** Runtime-native tool name == write-back id. SDK bare name (e.g. `Bash`) or `mcp__server__wire`. */
  name: string
  category: ClaudeToolCategory
  exposure: ClaudeToolExposure
  /** English copy shown in the catalog today; migrates to an i18n key in a later PR. */
  description: string
  /** Other tools this one requires — if any is disabled, this tool is disabled too (transitively). */
  dependsOn?: readonly string[]
  /** Set for in-process MCP tools — the server hosting this tool (drives injection). */
  mcpServer?: 'cherry-tools' | 'claw' | 'agent-memory' | 'skills'
}

/**
 * The registry. Keys are stable friendly identifiers; `name` is the runtime tool name.
 * For SDK tools key === name; for MCP tools key is friendly (e.g. `CherryWebSearch`).
 */
const CLAUDE_TOOL_REGISTRY = {
  // ── shell ────────────────────────────────────────────────────────
  Bash: {
    name: 'Bash',
    category: 'shell',
    exposure: 'user',
    description: 'Executes shell commands in your environment'
  },
  // Legacy runtime tool name (the SDK union types background output as TaskOutput); render-only.
  // Useless without Bash, so it follows Bash's enable state.
  BashOutput: {
    name: 'BashOutput',
    category: 'shell',
    exposure: 'internal',
    description: 'Retrieves output from a running background shell',
    dependsOn: ['Bash']
  },
  REPL: {
    name: 'REPL',
    category: 'shell',
    exposure: 'disabled',
    description: 'Runs code in a persistent REPL session'
  },

  // ── file ─────────────────────────────────────────────────────────
  Read: { name: 'Read', category: 'file', exposure: 'user', description: 'Reads the contents of files' },
  Edit: { name: 'Edit', category: 'file', exposure: 'user', description: 'Makes targeted edits to specific files' },
  Write: { name: 'Write', category: 'file', exposure: 'user', description: 'Creates or overwrites files' },
  NotebookEdit: {
    name: 'NotebookEdit',
    category: 'file',
    exposure: 'disabled',
    description: 'Modifies Jupyter notebook cells'
  },

  // ── search (local) ───────────────────────────────────────────────
  Glob: { name: 'Glob', category: 'search', exposure: 'user', description: 'Finds files based on pattern matching' },
  Grep: { name: 'Grep', category: 'search', exposure: 'user', description: 'Searches for patterns in file contents' },

  // ── orchestration ────────────────────────────────────────────────
  Agent: {
    name: 'Agent',
    category: 'orchestration',
    exposure: 'internal',
    description: 'Runs a sub-agent to handle complex, multi-step tasks'
  },
  // Legacy render-only alias of Agent; not a member of the SDK tool union.
  Task: {
    name: 'Task',
    category: 'orchestration',
    exposure: 'internal',
    description: 'Runs a sub-agent to handle complex, multi-step tasks'
  },
  TaskOutput: {
    name: 'TaskOutput',
    category: 'orchestration',
    exposure: 'internal',
    description: 'Gets output from a background task'
  },
  TaskStop: {
    name: 'TaskStop',
    category: 'orchestration',
    exposure: 'internal',
    description: 'Stops a running background task'
  },
  TaskCreate: {
    name: 'TaskCreate',
    category: 'orchestration',
    exposure: 'internal',
    description: 'Creates a structured task'
  },
  TaskGet: { name: 'TaskGet', category: 'orchestration', exposure: 'internal', description: 'Retrieves a task by id' },
  TaskUpdate: { name: 'TaskUpdate', category: 'orchestration', exposure: 'internal', description: 'Updates a task' },
  TaskList: { name: 'TaskList', category: 'orchestration', exposure: 'internal', description: 'Lists tasks' },
  TodoWrite: {
    name: 'TodoWrite',
    category: 'orchestration',
    exposure: 'disabled',
    description: 'Creates and manages structured task lists'
  },
  ExitPlanMode: {
    name: 'ExitPlanMode',
    category: 'orchestration',
    exposure: 'internal',
    description: 'Exits plan mode and presents the plan'
  },
  EnterPlanMode: {
    name: 'EnterPlanMode',
    category: 'orchestration',
    exposure: 'internal',
    description: 'Enters plan mode'
  },
  // Condition-gated (workspace has .git) — see toolConditions.ts in main.
  EnterWorktree: {
    name: 'EnterWorktree',
    category: 'orchestration',
    exposure: 'internal',
    description: 'Switches into a git worktree'
  },
  ExitWorktree: {
    name: 'ExitWorktree',
    category: 'orchestration',
    exposure: 'internal',
    description: 'Leaves the current git worktree'
  },
  AskUserQuestion: {
    name: 'AskUserQuestion',
    category: 'orchestration',
    exposure: 'internal',
    description: 'Asks the user a structured question'
  },
  // Meta tool surfaced via ENABLE_TOOL_SEARCH; not a member of the SDK tool union.
  ToolSearch: {
    name: 'ToolSearch',
    category: 'orchestration',
    exposure: 'internal',
    description: 'Searches for available tools by name'
  },
  ListMcpResources: {
    name: 'ListMcpResources',
    category: 'orchestration',
    exposure: 'internal',
    description: 'Lists resources from connected MCP servers'
  },
  ReadMcpResource: {
    name: 'ReadMcpResource',
    category: 'orchestration',
    exposure: 'internal',
    description: 'Reads a resource from a connected MCP server'
  },
  Workflow: {
    name: 'Workflow',
    category: 'orchestration',
    exposure: 'user',
    description: 'Runs a multi-step workflow that orchestrates subagents'
  },
  CronCreate: {
    name: 'CronCreate',
    category: 'orchestration',
    exposure: 'disabled',
    description: 'Creates a scheduled (cron) task'
  },
  CronDelete: {
    name: 'CronDelete',
    category: 'orchestration',
    exposure: 'disabled',
    description: 'Deletes a scheduled (cron) task'
  },
  CronList: {
    name: 'CronList',
    category: 'orchestration',
    exposure: 'disabled',
    description: 'Lists scheduled (cron) tasks'
  },
  ScheduleWakeup: {
    name: 'ScheduleWakeup',
    category: 'orchestration',
    exposure: 'disabled',
    description: 'Schedules a wakeup for the session'
  },
  RemoteTrigger: {
    name: 'RemoteTrigger',
    category: 'orchestration',
    exposure: 'disabled',
    description: 'Registers a remote trigger'
  },
  Monitor: {
    name: 'Monitor',
    category: 'orchestration',
    exposure: 'disabled',
    description: 'Monitors an external condition'
  },
  PushNotification: {
    name: 'PushNotification',
    category: 'orchestration',
    exposure: 'disabled',
    description: 'Sends a push notification'
  },
  // Agent-teams tools — runtime-injected behind CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS,
  // NOT members of the SDK ToolInputSchemas union.
  SendMessage: {
    name: 'SendMessage',
    category: 'orchestration',
    exposure: 'internal',
    description: 'Sends a message to another agent in the team'
  },
  TeamCreate: {
    name: 'TeamCreate',
    category: 'orchestration',
    exposure: 'internal',
    description: 'Creates an agent team'
  },
  TeamDelete: {
    name: 'TeamDelete',
    category: 'orchestration',
    exposure: 'internal',
    description: 'Deletes an agent team'
  },

  // ── context (external / persistent context) ──────────────────────
  // Native Web* are replaced by the cherry-tools equivalents below.
  WebSearch: {
    name: 'WebSearch',
    category: 'context',
    exposure: 'disabled',
    description: 'Performs web searches with domain filtering'
  },
  WebFetch: {
    name: 'WebFetch',
    category: 'context',
    exposure: 'disabled',
    description: 'Fetches content from a specified URL'
  },

  // ── in-process MCP tools ─────────────────────────────────────────
  // cherry-tools (always injected today)
  CherryWebSearch: {
    name: 'mcp__cherry-tools__web_search',
    category: 'context',
    exposure: 'user',
    description: 'Searches the web via your configured provider',
    mcpServer: 'cherry-tools'
  },
  CherryWebFetch: {
    name: 'mcp__cherry-tools__web_fetch',
    category: 'context',
    exposure: 'user',
    description: 'Fetches and reads a web page',
    mcpServer: 'cherry-tools'
  },
  CherryKbSearch: {
    name: 'mcp__cherry-tools__kb_search',
    category: 'context',
    exposure: 'user',
    description: 'Searches your knowledge bases',
    mcpServer: 'cherry-tools'
  },
  CherryKbList: {
    name: 'mcp__cherry-tools__kb_list',
    category: 'context',
    exposure: 'internal',
    description: 'Lists your knowledge bases',
    mcpServer: 'cherry-tools'
  },
  // claw (agent autonomy / channels). notify/config need a connected channel to do anything.
  ClawCron: {
    name: 'mcp__claw__cron',
    category: 'orchestration',
    exposure: 'user',
    description: 'Manages the in-app scheduler',
    mcpServer: 'claw'
  },
  // notify/config are condition-gated (agent has a connected channel) — see toolConditions.ts.
  ClawNotify: {
    name: 'mcp__claw__notify',
    category: 'orchestration',
    exposure: 'internal',
    description: 'Sends a notification through a connected channel',
    mcpServer: 'claw'
  },
  ClawConfig: {
    name: 'mcp__claw__config',
    category: 'orchestration',
    exposure: 'internal',
    description: 'Inspects and manages this agent configuration and channels',
    mcpServer: 'claw'
  },
  // agent-memory (cross-session memory)
  AgentMemory: {
    name: 'mcp__agent-memory__memory',
    category: 'context',
    exposure: 'user',
    description: 'Stores and recalls cross-session memory',
    mcpServer: 'agent-memory'
  },
  // skills (marketplace + authoring)
  Skills: {
    name: 'mcp__skills__skills',
    category: 'context',
    exposure: 'internal',
    description: 'Searches, installs, and authors skills',
    mcpServer: 'skills'
  }
} as const satisfies Record<string, ClaudeToolDescriptorDef>

export type ClaudeToolKey = keyof typeof CLAUDE_TOOL_REGISTRY

export const CLAUDE_TOOL_DEFS: readonly ClaudeToolDescriptorDef[] = Object.values(CLAUDE_TOOL_REGISTRY)

/** A tool is an in-process MCP tool iff it declares a hosting server. */
export const isMcpTool = (def: ClaudeToolDescriptorDef): boolean => def.mcpServer !== undefined

/**
 * Descriptors for the canUseTool / catalog policy layer: every non-disabled SDK tool.
 * Disabled tools are omitted (they are hard-blocked via disallowedTools and never invoked).
 */
export function claudeRegistrySdkDescriptors(): ClaudeToolDescriptor[] {
  return CLAUDE_TOOL_DEFS.filter((def) => !isMcpTool(def) && def.exposure !== 'disabled').map((def) => ({
    id: def.name,
    name: def.name,
    description: def.description,
    origin: 'builtin'
  }))
}

/** Display order of category sections in the edit-dialog tool catalog. */
export const CLAUDE_TOOL_CATEGORIES: readonly ClaudeToolCategory[] = [
  'file',
  'shell',
  'search',
  'context',
  'orchestration',
  'media'
]

export interface ClaudeUserFacingTool {
  key: ClaudeToolKey
  /** Runtime tool name == write-back id into `disabledTools`. */
  name: string
  /** Short human label for the catalog (interim English; → i18n key later). */
  label: string
  category: ClaudeToolCategory
  description: string
}

/** Friendly labels for MCP wire tools whose `name` is an opaque `mcp__server__wire` id. */
const MCP_TOOL_LABELS: Record<string, string> = {
  'mcp__cherry-tools__web_search': 'Web Search',
  'mcp__cherry-tools__web_fetch': 'Web Fetch',
  'mcp__cherry-tools__kb_search': 'Knowledge Search',
  'mcp__agent-memory__memory': 'Memory',
  mcp__claw__cron: 'Scheduler'
}

/**
 * The tools shown in the edit-dialog catalog (exposure `user`), across SDK + in-process MCP.
 * `internal` / condition-gated / `disabled` tools are intentionally hidden from the UI.
 */
export function claudeUserFacingTools(): ClaudeUserFacingTool[] {
  return (Object.entries(CLAUDE_TOOL_REGISTRY) as [ClaudeToolKey, ClaudeToolDescriptorDef][])
    .filter(([, def]) => def.exposure === 'user')
    .map(([key, def]) => ({
      key,
      name: def.name,
      label: isMcpTool(def) ? (MCP_TOOL_LABELS[def.name] ?? def.name) : def.name,
      category: def.category,
      description: def.description
    }))
}
