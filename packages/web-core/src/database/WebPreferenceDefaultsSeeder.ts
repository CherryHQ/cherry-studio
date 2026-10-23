import { preferenceTable } from '@data/db/schemas/preference'
import { hashObject } from '@data/db/seeding/hashObject'
import type { DbType, ISeeder } from '@data/db/types'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'

const desktopDefaults = DefaultPreferences.default

const WEB_SIDEBAR_RESOURCES = new Set(['agents', 'assistants'])

/**
 * First-run preferences where the Web edition differs from the desktop: the sidebar offers only chat
 * and agents, and desktop-only features (the agent browser, skills, web search, exports to Word and
 * note apps) are off or left out of the toolbars and menus.
 */
const webDefaults: Partial<typeof desktopDefaults> = {
  'ui.sidebar_shortcut': desktopDefaults['ui.sidebar_shortcut'].filter(
    ({ target }) => target.kind === 'resource' && WEB_SIDEBAR_RESOURCES.has(target.locator.resourceId)
  ),
  'app.browser.agent_control.enabled': false,
  'agent.input.toolbar.pinned_tools': desktopDefaults['agent.input.toolbar.pinned_tools'].filter(
    (id) => id !== 'skills'
  ),
  'chat.input.toolbar.pinned_tools': desktopDefaults['chat.input.toolbar.pinned_tools'].filter(
    (id) => id !== 'web-search'
  ),
  'data.export.menus.docx': false,
  'data.export.menus.joplin': false,
  'data.export.menus.notion': false,
  'data.export.menus.obsidian': false,
  'data.export.menus.siyuan': false,
  'data.export.menus.yuque': false
}

/**
 * Runs before the desktop seeders, which only insert missing preferences, so these rows win on
 * first run and later user changes are kept.
 */
export class WebPreferenceDefaultsSeeder implements ISeeder {
  readonly name = 'web-preference-defaults'
  readonly description = 'Insert the Web edition preference defaults'
  readonly version = hashObject(webDefaults)

  run(db: DbType): void {
    const rows = Object.entries(webDefaults).map(([key, value]) => ({ scope: 'default', key, value }))
    db.insert(preferenceTable).values(rows).onConflictDoNothing().run()
  }
}
