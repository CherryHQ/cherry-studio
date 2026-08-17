/**
 * WebUI desktop bridge — Windows / macOS / Linux.
 * Public surface only; implementation lives in named modules.
 */
export type { WebUiServiceStartOptions, WebUiServiceStartResult } from './WebUiService'
export {
  isWebUiHostSupported,
  normalizeWebUiHost,
  normalizeWebUiPort,
  WEBUI_DEFAULT_HOST,
  WEBUI_DEFAULT_PORT,
  WEBUI_MAX_PORT,
  WEBUI_MIN_PORT,
  WebUiService
} from './WebUiService'
