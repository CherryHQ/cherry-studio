export enum AgentToolsType {
  Read = 'Read',
  Task = 'Task',
  Bash = 'Bash',
  Search = 'Search',
  Glob = 'Glob',
  TodoWrite = 'TodoWrite',
  WebSearch = 'WebSearch',
  Grep = 'Grep',
  Write = 'Write'
}

// Read 工具的类型定义
export interface ReadToolInput {
  file_path: string
}

export type ReadToolOutput = string

// Task 工具的类型定义
export type TaskToolInput = {
  description: string
  prompt: string
  subagent_type: string
}

export type TaskToolOutput = {
  type: 'text'
  text: string
}[]

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
  status: string
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

// Grep 工具的类型定义
export interface GrepToolInput {
  pattern: string
  output_mode: string
}

export type GrepToolOutput = string

export type WriteToolInput = {
  content: string
  file_path: string
}

export type WriteToolOutput = string

// 联合类型
export type ToolInput =
  | ReadToolInput
  | TaskToolInput
  | BashToolInput
  | SearchToolInput
  | GlobToolInput
  | TodoWriteToolInput
  | WebSearchToolInput
  | GrepToolInput
  | WriteToolInput
export type ToolOutput =
  | ReadToolOutput
  | TaskToolOutput
  | BashToolOutput
  | SearchToolOutput
  | GlobToolOutput
  | TodoWriteToolOutput
  | WebSearchToolOutput
  | GrepToolOutput
  | WriteToolOutput
// 工具渲染器接口
export interface ToolRenderer {
  render: (props: { input: ToolInput; output?: ToolOutput }) => React.ReactElement
}
