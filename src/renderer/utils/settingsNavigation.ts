export const SETTINGS_NAVIGATION_LABEL_KEYS = {
  '/settings/provider': 'settings.provider.title',
  '/settings/model': 'settings.model',
  '/settings/local-models': 'settings.dependencies.localModels.title',
  '/settings/api-gateway': 'apiGateway.title',
  '/settings/mcp': 'agent.settings.toolsMcp.mcp.tab',
  '/settings/skills': 'settings.skills.title',
  '/settings/prompts': 'settings.prompts.title',
  '/settings/websearch': 'settings.tool.websearch.title',
  '/settings/file-processing': 'settings.tool.file_processing.features.document_to_markdown.title',
  '/settings/ocr': 'settings.tool.file_processing.features.image_to_text.title',
  '/settings/general': 'settings.general.common.title',
  '/settings/appearance': 'settings.appearance.title',
  '/settings/notifications': 'settings.notification.title',
  '/settings/data': 'settings.data.title',
  '/settings/usage': 'settings.usage.title',
  '/settings/channels': 'settings.channels.title',
  '/settings/scheduled-tasks': 'settings.scheduledTasks.title',
  '/settings/shortcut': 'settings.shortcuts.title',
  '/settings/quick-assistant': 'settings.quickAssistant.title',
  '/settings/selection-assistant': 'selection.name',
  '/settings/screenshot': 'settings.screenshot.title',
  '/settings/dependencies': 'settings.dependencies.title',
  '/settings/about': 'settings.about.label'
} as const

const SETTINGS_NAVIGATION_LABEL_ENTRIES = Object.entries(SETTINGS_NAVIGATION_LABEL_KEYS).sort(
  ([left], [right]) => right.length - left.length
)

export function getSettingsNavigationLabelKey(pathname: string): string | undefined {
  const normalized = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  return SETTINGS_NAVIGATION_LABEL_ENTRIES.find(
    ([path]) => normalized === path || normalized.startsWith(`${path}/`)
  )?.[1]
}
