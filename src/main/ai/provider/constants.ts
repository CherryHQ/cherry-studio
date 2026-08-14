export const COPILOT_EDITOR_VERSION = 'vscode/1.104.1'
export const COPILOT_PLUGIN_VERSION = 'copilot-chat/0.26.7'
export const COPILOT_INTEGRATION_ID = 'vscode-chat'
export const COPILOT_USER_AGENT = 'GitHubCopilotChat/0.26.7'

export const COPILOT_DEFAULT_HEADERS = {
  'Copilot-Integration-Id': COPILOT_INTEGRATION_ID,
  'User-Agent': COPILOT_USER_AGENT,
  'Editor-Version': COPILOT_EDITOR_VERSION,
  'Editor-Plugin-Version': COPILOT_PLUGIN_VERSION,
  'editor-version': COPILOT_EDITOR_VERSION,
  'editor-plugin-version': COPILOT_PLUGIN_VERSION,
  'copilot-vision-request': 'true'
} as const
