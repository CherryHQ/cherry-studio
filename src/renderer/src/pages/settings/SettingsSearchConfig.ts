/**
 * Settings Search Configuration
 * Contains route mappings and search exclusion rules
 */

/**
 * Maps translation key prefixes to their corresponding settings page routes
 * When a translation key starts with one of these prefixes, clicking it will navigate to the mapped route
 */
export const ROUTE_MAPPING: Record<string, string> = {
  // General settings page
  'settings.general': '/settings/general',
  'settings.proxy': '/settings/general',
  'settings.notification': '/settings/general',
  'settings.launch': '/settings/general',
  'settings.tray': '/settings/general',
  'settings.privacy': '/settings/general',
  'settings.developer': '/settings/general',
  'settings.hardware_acceleration': '/settings/general',

  // Model settings page
  'settings.model': '/settings/model',
  'settings.models': '/settings/model',

  // Provider settings page
  'settings.provider': '/settings/provider',

  // Display settings page
  'settings.display': '/settings/display',
  'settings.theme': '/settings/display',
  'settings.zoom': '/settings/display',
  'settings.topic': '/settings/display',
  'settings.advanced': '/settings/display',
  'settings.assistant': '/settings/display',
  'settings.messages': '/settings/display',
  'settings.miniapps': '/settings/display',
  'settings.openai': '/settings/display',
  'settings.quickPanel': '/settings/display',
  'settings.tool.ocr': '/settings/display',

  // Data settings page
  'settings.data': '/settings/data',
  'settings.translate': '/settings/data',

  // Other settings pages
  'settings.mcp': '/settings/mcp',
  'settings.tool.websearch': '/settings/websearch',
  memory: '/settings/memory',
  apiServer: '/settings/api-server',
  'settings.tool.preprocess': '/settings/docprocess',
  'settings.quickPhrase': '/settings/quickphrase',
  'settings.shortcuts': '/settings/shortcut',
  'settings.quickAssistant': '/settings/quickAssistant',
  selection: '/settings/selectionAssistant',
  'settings.about': '/settings/about'
}

/**
 * Maps route paths to their display title translation keys
 * Used to show the section name in search result tags
 */
export const ROUTE_TITLES: Record<string, string> = {
  '/settings/general': 'settings.general.label',
  '/settings/model': 'settings.model',
  '/settings/provider': 'settings.provider.title',
  '/settings/display': 'settings.display.title',
  '/settings/data': 'settings.data.title',
  '/settings/mcp': 'settings.mcp.title',
  '/settings/websearch': 'settings.tool.websearch.title',
  '/settings/memory': 'memory.title',
  '/settings/api-server': 'apiServer.title',
  '/settings/docprocess': 'settings.tool.preprocess.title',
  '/settings/quickphrase': 'settings.quickPhrase.title',
  '/settings/shortcut': 'settings.shortcuts.title',
  '/settings/quickAssistant': 'settings.quickAssistant.title',
  '/settings/selectionAssistant': 'selection.name',
  '/settings/about': 'settings.about.label'
}

/**
 * Translation key prefixes to exclude from search results
 * All keys starting with these prefixes will be hidden from search
 *
 * Examples:
 * - 'settings.tool.websearch.tavily.api_key' excludes all keys under tavily.api_key
 * - 'settings.provider.api_key' excludes provider API key related entries
 */
export const SEARCH_EXCLUDED_PREFIXES: string[] = ['settings.tool.websearch.tavily.api_key']
