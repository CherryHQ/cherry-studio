export const BROWSER_TOOL_GROUP = 'mcp__browser'

export const BROWSER_TOOLS = [
  { name: 'open', labelKey: 'settings.browser.tools.open' },
  { name: 'snapshot', labelKey: 'settings.browser.tools.snapshot' },
  { name: 'screenshot', labelKey: 'settings.browser.tools.screenshot' },
  { name: 'find', labelKey: 'settings.browser.tools.find' },
  { name: 'list_tabs', labelKey: 'settings.browser.tools.list_tabs' },
  { name: 'click', labelKey: 'settings.browser.tools.click' },
  { name: 'hover', labelKey: 'settings.browser.tools.hover' },
  { name: 'scroll', labelKey: 'settings.browser.tools.scroll' },
  { name: 'type', labelKey: 'settings.browser.tools.type' },
  { name: 'press_key', labelKey: 'settings.browser.tools.press_key' },
  { name: 'select_option', labelKey: 'settings.browser.tools.select_option' },
  { name: 'go_back', labelKey: 'settings.browser.tools.go_back' },
  { name: 'go_forward', labelKey: 'settings.browser.tools.go_forward' },
  { name: 'wait_for', labelKey: 'settings.browser.tools.wait_for' },
  { name: 'handle_dialog', labelKey: 'settings.browser.tools.handle_dialog' },
  { name: 'console_messages', labelKey: 'settings.browser.tools.console_messages' },
  { name: 'network_requests', labelKey: 'settings.browser.tools.network_requests' },
  { name: 'execute', labelKey: 'settings.browser.tools.execute' }
] as const

export const BROWSER_TOOL_NAMES = BROWSER_TOOLS.map((tool) => tool.name)

export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number]

export function browserToolFromRuntimeName(name: string): BrowserToolName | undefined {
  return BROWSER_TOOL_NAMES.find((tool) => name === `mcp__browser__${tool}`)
}
