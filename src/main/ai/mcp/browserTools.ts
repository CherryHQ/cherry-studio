export const BROWSER_TOOL_NAMES = [
  'open',
  'snapshot',
  'screenshot',
  'list_web_tools',
  'call_web_tool',
  'find',
  'list_tabs',
  'click',
  'hover',
  'scroll',
  'type',
  'press_key',
  'select_option',
  'go_back',
  'go_forward',
  'wait_for',
  'handle_dialog',
  'console_messages',
  'network_requests',
  'execute'
] as const

export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number]

export function browserToolFromRuntimeName(name: string): BrowserToolName | undefined {
  return BROWSER_TOOL_NAMES.find((tool) => name === `mcp__browser__${tool}`)
}
