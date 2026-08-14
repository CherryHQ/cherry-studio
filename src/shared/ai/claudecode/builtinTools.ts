import type { Tool } from '../tool'
import type { ClaudeToolDescriptor } from './toolRules'

function builtinTool(name: string, description: string, defaultPrompt: boolean): Tool {
  return {
    id: name,
    name,
    description,
    origin: 'builtin',
    approval: defaultPrompt ? 'prompt' : 'auto'
  }
}

// https://docs.anthropic.com/en/docs/claude-code/settings#tools-available-to-claude
export const claudeCodeBuiltinTools: Tool[] = [
  builtinTool('Bash', 'Executes shell commands in your environment', true),
  builtinTool('Edit', 'Makes targeted edits to specific files', true),
  builtinTool('Glob', 'Finds files based on pattern matching', false),
  builtinTool('Grep', 'Searches for patterns in file contents', false),
  builtinTool('MultiEdit', 'Performs multiple edits on a single file atomically', true),
  builtinTool('NotebookEdit', 'Modifies Jupyter notebook cells', true),
  builtinTool('NotebookRead', 'Reads and displays Jupyter notebook contents', false),
  builtinTool('Read', 'Reads the contents of files', false),
  builtinTool('Task', 'Runs a sub-agent to handle complex, multi-step tasks', false),
  builtinTool('TodoWrite', 'Creates and manages structured task lists', false),
  builtinTool('WebFetch', 'Fetches content from a specified URL', true),
  builtinTool('WebSearch', 'Performs web searches with domain filtering', true),
  builtinTool('Write', 'Creates or overwrites files', true)
]

export function claudeCodeBuiltinToolDescriptors(): ClaudeToolDescriptor[] {
  return claudeCodeBuiltinTools.map((tool) => ({
    id: tool.id,
    name: tool.name,
    description: tool.description,
    origin: 'builtin'
  }))
}
