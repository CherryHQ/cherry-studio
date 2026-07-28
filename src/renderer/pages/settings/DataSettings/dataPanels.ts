import * as z from 'zod'

/** Menu keys of the data settings submenu panels (order = menu order) */
export const DATA_PANEL_KEYS = [
  'data',
  'local_backup',
  'webdav',
  'nutstore',
  's3',
  'import_settings',
  'export_menu',
  'markdown_export',
  'notion',
  'yuque',
  'joplin',
  'obsidian',
  'siyuan'
] as const

export type DataPanelKey = (typeof DATA_PANEL_KEYS)[number]

export const DEFAULT_DATA_PANEL: DataPanelKey = 'data'

/**
 * Search-param schema for /settings/data. Unknown panel values (hand-edited
 * or stale URLs) degrade to the default panel instead of rendering a blank
 * column.
 */
export const dataPanelSearchSchema = z.object({
  panel: z.enum(DATA_PANEL_KEYS).optional().catch(undefined)
})
