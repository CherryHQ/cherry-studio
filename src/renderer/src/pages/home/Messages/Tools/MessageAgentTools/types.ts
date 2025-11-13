export enum AgentToolsType {
  Skill = 'Skill',
  Read = 'Read',
  Task = 'Task',
  Bash = 'Bash',
  Search = 'Search',
  Glob = 'Glob',
  TodoWrite = 'TodoWrite',
  WebSearch = 'WebSearch',
  Grep = 'Grep',
  Write = 'Write',
  WebFetch = 'WebFetch',
  Edit = 'Edit',
  MultiEdit = 'MultiEdit',
  BashOutput = 'BashOutput',
  NotebookEdit = 'NotebookEdit',
  ExitPlanMode = 'ExitPlanMode'
}

export type TextOutput = {
  type: 'text'
  text: string
}

// Read 工具的类型定义
export interface SkillToolInput {
  /**
   * The skill to use
   */
  command: string
}

export type SkillToolOutput = string

export interface ReadToolInput {
  /**
   * The absolute path to the file to read
   */
  file_path: string
  /**
   * The line number to start reading from
   */
  offset?: number
  /**
   * The number of lines to read
   */
  limit?: number
}

export type ReadToolOutput = string | TextOutput[]

// Task 工具的类型定义
export type TaskToolInput = {
  /**
   * A short (3-5 word) description of the task
   */
  description: string
  /**
   * The task for the agent to perform
   */
  prompt: string
  /**
   * The type of specialized agent to use for this task
   */
  subagent_type: string
}

export type TaskToolOutput = TextOutput[]

// Bash 工具的类型定义
export type BashToolInput = {
  /**
   * The command to execute
   */
  command: string
  /**
   * Optional timeout in milliseconds (max 600000)
   */
  timeout?: number
  /**
   * Clear, concise description of what this command does in 5-10 words
   */
  description?: string
  /**
   * Set to true to run this command in the background
   */
  run_in_background?: boolean
}

export type BashToolOutput = string

// Search 工具的类型定义
export type SearchToolInput = string

export type SearchToolOutput = string

// Glob 工具的类型定义
export interface GlobToolInput {
  /**
   * The glob pattern to match files against
   */
  pattern: string
  /**
   * The directory to search in (defaults to cwd)
   */
  path?: string
}

export type GlobToolOutput = string

// TodoWrite 工具的类型定义
export interface TodoItem {
  /**
   * The task description
   */
  content: string
  /**
   * The task status
   */
  status: 'pending' | 'in_progress' | 'completed'
  /**
   * Active form of the task description
   */
  activeForm: string
}

export type TodoWriteToolInput = {
  todos: TodoItem[]
}

export type TodoWriteToolOutput = string

// WebSearch 工具的类型定义
export interface WebSearchToolInput {
  /**
   * The search query to use
   */
  query: string
  /**
   * Only include results from these domains
   */
  allowed_domains?: string[]
  /**
   * Never include results from these domains
   */
  blocked_domains?: string[]
}
export type WebSearchToolOutput = string

// WebFetch 工具的类型定义
export type WebFetchToolInput = {
  /**
   * The URL to fetch content from
   */
  url: string
  /**
   * The prompt to run on the fetched content
   */
  prompt: string
}
export type WebFetchToolOutput = string

// Grep 工具的类型定义
export interface GrepToolInput {
  /**
   * The regular expression pattern to search for
   */
  pattern: string
  /**
   * File or directory to search in (defaults to cwd)
   */
  path?: string
  /**
   * Glob pattern to filter files (e.g. "*.js")
   */
  glob?: string
  /**
   * File type to search (e.g. "js", "py", "rust")
   */
  type?: string
  /**
   * Output mode: "content", "files_with_matches", or "count"
   */
  output_mode?: 'content' | 'files_with_matches' | 'count'
  /**
   * Case insensitive search
   */
  '-i'?: boolean
  /**
   * Show line numbers (for content mode)
   */
  '-n'?: boolean
  /**
   * Lines to show before each match
   */
  '-B'?: number
  /**
   * Lines to show after each match
   */
  '-A'?: number
  /**
   * Lines to show before and after each match
   */
  '-C'?: number
  /**
   * Limit output to first N lines/entries
   */
  head_limit?: number
  /**
   * Enable multiline mode
   */
  multiline?: boolean
}

export type GrepToolOutput = string

// Write 工具的类型定义
export type WriteToolInput = {
  /**
   * The absolute path to the file to write
   */
  file_path: string
  /**
   * The content to write to the file
   */
  content: string
}

export type WriteToolOutput = string

// Edit 工具的类型定义
export type EditToolInput = {
  /**
   * The absolute path to the file to modify
   */
  file_path: string
  /**
   * The text to replace
   */
  old_string: string
  /**
   * The text to replace it with (must be different from old_string)
   */
  new_string: string
  /**
   * Replace all occurrences of old_string (default false)
   */
  replace_all?: boolean
}
export type EditToolOutput = string

// MultiEdit 工具的类型定义
export type MultiEditToolInput = {
  /**
   * The absolute path to the file to modify
   */
  file_path: string
  /**
   * Array of edit operations to perform sequentially
   */
  edits: Array<{
    /**
     * The text to replace
     */
    old_string: string
    /**
     * The text to replace it with
     */
    new_string: string
    /**
     * Replace all occurrences (default false)
     */
    replace_all?: boolean
  }>
}
export type MultiEditToolOutput = string

// BashOutput 工具的类型定义
export type BashOutputToolInput = {
  /**
   * The ID of the background shell to retrieve output from
   */
  bash_id: string
  /**
   * Optional regex to filter output lines
   */
  filter?: string
}
export type BashOutputToolOutput = string

// NotebookEdit 工具的类型定义
export type NotebookEditToolInput = {
  /**
   * The absolute path to the Jupyter notebook file
   */
  notebook_path: string
  /**
   * The ID of the cell to edit
   */
  cell_id?: string
  /**
   * The new source for the cell
   */
  new_source: string
  /**
   * The type of the cell (code or markdown)
   */
  cell_type?: 'code' | 'markdown'
  /**
   * The type of edit (replace, insert, delete)
   */
  edit_mode?: 'replace' | 'insert' | 'delete'
}
export type NotebookEditToolOutput = string

// ExitPlanModeToolInput
export type ExitPlanModeToolInput = {
  /**
   * The plan to run by the user for approval
   */
  plan: string
}
export type ExitPlanModeToolOutput = string

// ListMcpResourcesToolInput
export type ListMcpResourcesToolInput = {
  /**
   * Optional server name to filter resources by
   */
  server?: string
}
// ReadMcpResourceToolInput
export type ReadMcpResourceToolInput = {
  /**
   * The MCP server name
   */
  server: string
  /**
   * The resource URI to read
   */
  uri: string
}
export type KillBashToolInput = {
  /**
   * The ID of the background shell to kill
   */
  shell_id: string
}
// 联合类型
export type ToolInput =
  | TaskToolInput
  | BashToolInput
  | BashOutputToolInput
  | EditToolInput
  | MultiEditToolInput
  | ReadToolInput
  | WriteToolInput
  | GlobToolInput
  | GrepToolInput
  | KillBashToolInput
  | NotebookEditToolInput
  | WebFetchToolInput
  | WebSearchToolInput
  | TodoWriteToolInput
  | ExitPlanModeToolInput
  | ListMcpResourcesToolInput
  | ReadMcpResourceToolInput

export type ToolOutput =
  | ReadToolOutput
  | TaskToolOutput
  | BashToolOutput
  | SearchToolOutput
  | GlobToolOutput
  | TodoWriteToolOutput
  | WebSearchToolOutput
  | GrepToolOutput
  | WebFetchToolOutput
  | WriteToolOutput
  | EditToolOutput
  | MultiEditToolOutput
  | BashOutputToolOutput
  | NotebookEditToolOutput
  | ExitPlanModeToolOutput
// 工具渲染器接口
export interface ToolRenderer {
  render: (props: { input: ToolInput; output?: ToolOutput }) => React.ReactElement
}
