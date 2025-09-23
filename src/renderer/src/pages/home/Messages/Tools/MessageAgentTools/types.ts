export enum AgentToolsType {
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
export interface ReadToolInput {
  file_path: string
}

export type ReadToolOutput = string | TextOutput[]

// Task 工具的类型定义
export type TaskToolInput = {
  description: string
  prompt: string
  subagent_type: string
}

export type TaskToolOutput = TextOutput[]

// Bash 工具的类型定义
export type BashToolInput = {
  command: string
  description: string
}

export type BashToolOutput = string

// Search 工具的类型定义
export type SearchToolInput = string

export type SearchToolOutput = string

// Glob 工具的类型定义
export interface GlobToolInput {
  pattern: string
}

export type GlobToolOutput = string

// TodoWrite 工具的类型定义
export interface TodoItem {
  content: string
  status: 'completed' | 'in_progress' | 'pending'
  activeForm?: string
}

export type TodoWriteToolInput = {
  todos: TodoItem[]
}

export type TodoWriteToolOutput = string

// WebSearch 工具的类型定义
export interface WebSearchToolInput {
  query: string
}
export type WebSearchToolOutput = string

// WebFetch 工具的类型定义
export type WebFetchToolInput = {
  prompt: string
  url: string
}
export type WebFetchToolOutput = string

// Grep 工具的类型定义
export interface GrepToolInput {
  pattern: string
  output_mode: string
}

export type GrepToolOutput = string

// Write 工具的类型定义
export type WriteToolInput = {
  content: string
  file_path: string
}

export type WriteToolOutput = string

// Edit 工具的类型定义
export type EditToolInput = {
  file_path: string
  old_string: string
  new_string: string
}
export type EditToolOutput = string

// MultiEdit 工具的类型定义
export type MultiEditToolInput = {
  file_path: string
  edits: {
    old_string: string
    new_string: string
  }[]
}
export type MultiEditToolOutput = string

// BashOutput 工具的类型定义
export type BashOutputToolInput = {
  bash_id: string
}
export type BashOutputToolOutput = string

// NotebookEdit 工具的类型定义
export type NotebookEditToolInput = {
  notebook_path: string
  edit_mode: string
  cell_type: string
  new_source: string
}
export type NotebookEditToolOutput = string

export type ExitPlanModeToolInput = {
  plan: string
}
export type ExitPlanModeToolOutput = string

// 联合类型
export type ToolInput =
  | ReadToolInput
  | TaskToolInput
  | BashToolInput
  | SearchToolInput
  | GlobToolInput
  | TodoWriteToolInput
  | WebSearchToolInput
  | WebFetchToolInput
  | GrepToolInput
  | WriteToolInput
  | EditToolInput
  | MultiEditToolInput
  | BashOutputToolInput
  | NotebookEditToolInput
  | ExitPlanModeToolInput
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
