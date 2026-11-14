/** Pages of the paged edit dialog. Sub-pages go back to `more`, and `more` goes back to `main`. */
export type EditPage =
  | 'main'
  | 'more'
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

export type EditSubPage = Exclude<EditPage, 'main' | 'more'>

const AGENT_INITIAL_PAGES: Record<string, EditPage> = {
  basic: 'main',
  prompt: 'prompt',
  'tools.builtin': 'tools',
  'tools.skills': 'skills',
  'tools.knowledge': 'knowledge',
  'tools.mcp': 'mcp',
  advanced: 'more',
  memory: 'memory',
  channels: 'channels',
  tasks: 'tasks'
}

const ASSISTANT_INITIAL_PAGES: Record<string, EditPage> = {
  basic: 'main',
  prompt: 'prompt',
  'tools.builtin': 'more',
  'tools.knowledge': 'knowledge',
  'tools.mcp': 'more',
  advanced: 'more'
}

/**
 * The page a deep link (`initialTab`) opens. Unknown IDs open the main page; a sub-page the
 * resource does not offer (its runtime has no MCP, say) opens More settings instead.
 */
export function resolveInitialEditPage(
  kind: 'agent' | 'assistant',
  initialTab: string | undefined,
  availableSubPages: ReadonlySet<EditSubPage>
): EditPage {
  const page = (kind === 'agent' ? AGENT_INITIAL_PAGES : ASSISTANT_INITIAL_PAGES)[initialTab ?? ''] ?? 'main'
  if (page === 'main' || page === 'more') return page
  return availableSubPages.has(page) ? page : 'more'
}

export function parentEditPage(page: EditPage): EditPage {
  return page === 'more' ? 'main' : 'more'
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
