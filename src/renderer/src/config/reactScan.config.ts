import type { Options } from 'react-scan'

/**
 * React-Scan configuration for development performance monitoring
 * Enable via: yarn dev:react-scan
 * @see https://react-scan.million.dev/
 */
export const reactScanConfig: Options = {
  enabled: true,
  log: false,
  showToolbar: true,
  animationSpeed: 'fast',
  trackUnnecessaryRenders: true,
  showFPS: true,
  showNotificationCount: true,
  allowInIframe: false,
  _debug: false
}
