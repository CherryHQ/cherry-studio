/** Pages of the paged edit dialog. The dialog opens on `settings`, and every sub-page goes back to it. */
export type EditPage =
  | 'settings'
  | 'prompt'
  | 'tools'
  | 'skills'
  | 'knowledge'
  | 'mcp'
  | 'channels'
  | 'tasks'
  | 'memory'
  | 'context'
  | 'parameters'

export type EditSubPage = Exclude<EditPage, 'settings'>

const AGENT_INITIAL_PAGES: Record<string, EditPage> = {
  basic: 'settings',
  prompt: 'prompt',
  'tools.builtin': 'tools',
  'tools.skills': 'skills',
  'tools.knowledge': 'knowledge',
  'tools.mcp': 'mcp',
  advanced: 'settings',
  memory: 'memory',
  channels: 'channels',
  tasks: 'tasks'
}

const ASSISTANT_INITIAL_PAGES: Record<string, EditPage> = {
  basic: 'settings',
  prompt: 'prompt',
  'tools.builtin': 'settings',
  'tools.knowledge': 'knowledge',
  'tools.mcp': 'settings',
  advanced: 'settings'
}

/**
 * The page a deep link (`initialTab`) opens. Unknown IDs, and a sub-page the resource does not
 * offer (its runtime has no MCP, say), open the settings page.
 */
export function resolveInitialEditPage(
  kind: 'agent' | 'assistant',
  initialTab: string | undefined,
  availableSubPages: ReadonlySet<EditSubPage>
): EditPage {
  const page = (kind === 'agent' ? AGENT_INITIAL_PAGES : ASSISTANT_INITIAL_PAGES)[initialTab ?? ''] ?? 'settings'
  return page === 'settings' || availableSubPages.has(page) ? page : 'settings'
}

/** `Enabled 2 / 5`-style summary for a capability row; nothing to count reads as not added. */
export function countSummary(
  t: (key: string, options?: Record<string, unknown>) => string,
  verb: 'enabled' | 'linked',
  on: number,
  total: number
): string {
  if (total === 0) return t('library.config.dialogs.edit.count.none')
  return verb === 'linked'
    ? t('library.config.dialogs.edit.count.linked', { on, total })
    : t('library.config.dialogs.edit.count.enabled', { on, total })
}
