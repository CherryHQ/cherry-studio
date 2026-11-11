import { ipcRenderer, webFrame } from 'electron'

// Inject stealth evasions into the page's main world (worldId: 0) before any site scripts execute.
// Masks navigator.webdriver, normalizes userAgentData brands & client hints, and removes Electron signatures.
try {
  const chromeMajor = process.versions?.chrome ? process.versions.chrome.split('.')[0] : '132'
  const chromeFull = process.versions?.chrome || '132.0.6834.196'

  void webFrame
    .executeJavaScriptInIsolatedWorld(0, [
      {
        code: `
        (() => {
          try {
            // 1. Mask navigator.webdriver
            Object.defineProperty(navigator, 'webdriver', {
              get: () => undefined,
              configurable: true
            });
            if (Object.getPrototypeOf(navigator)) {
              delete Object.getPrototypeOf(navigator).webdriver;
            }
          } catch (_) {}

          try {
            // 2. Delegate to native userAgentData, preserving requested fields & host metadata while normalizing brands
            const origUAData = navigator.userAgentData;
            if (origUAData) {
              const chromeMajor = '${chromeMajor}';
              const chromeFull = '${chromeFull}';
              const cleanBrands = [
                { brand: 'Chromium', version: chromeMajor },
                { brand: 'Google Chrome', version: chromeMajor },
                { brand: 'Not A(Brand', version: '24' }
              ];
              const cleanFullVersionList = [
                { brand: 'Chromium', version: chromeFull },
                { brand: 'Google Chrome', version: chromeFull },
                { brand: 'Not A(Brand', version: '24.0.0.0' }
              ];

              const nativeGetHighEntropyValues = typeof origUAData.getHighEntropyValues === 'function'
                ? origUAData.getHighEntropyValues.bind(origUAData)
                : null;

              const proxyUAData = new Proxy(origUAData, {
                get(target, prop, receiver) {
                  if (prop === 'brands') {
                    return cleanBrands;
                  }
                  if (prop === 'toJSON') {
                    return () => {
                      const base = typeof target.toJSON === 'function' ? target.toJSON.call(target) : {};
                      return {
                        ...base,
                        brands: cleanBrands,
                        mobile: Reflect.get(target, 'mobile', target),
                        platform: Reflect.get(target, 'platform', target)
                      };
                    };
                  }
                  if (prop === 'getHighEntropyValues') {
                    return async (hints) => {
                      const result = nativeGetHighEntropyValues ? await nativeGetHighEntropyValues(hints) : {};
                      result.brands = cleanBrands;
                      if (Array.isArray(hints)) {
                        if (hints.includes('fullVersionList')) {
                          result.fullVersionList = cleanFullVersionList;
                        }
                        if (hints.includes('uaFullVersion')) {
                          result.uaFullVersion = chromeFull;
                        }
                      } else {
                        if (result.fullVersionList) {
                          result.fullVersionList = cleanFullVersionList;
                        }
                        if (result.uaFullVersion) {
                          result.uaFullVersion = chromeFull;
                        }
                      }
                      return result;
                    };
                  }
                  const val = Reflect.get(target, prop, target);
                  return typeof val === 'function' ? val.bind(target) : val;
                }
              });

              Object.defineProperty(navigator, 'userAgentData', {
                get: () => proxyUAData,
                configurable: true
              });
            }
          } catch (_) {}

          try {
            // 3. Mock window.chrome standard properties
            if (!window.chrome) window.chrome = {};
            if (!window.chrome.app) {
              window.chrome.app = {
                isInstalled: false,
                InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
                RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
              };
            }
            if (!window.chrome.csi) window.chrome.csi = function() { return {}; };
            if (!window.chrome.loadTimes) {
              window.chrome.loadTimes = function() {
                return {
                  commitLoadTime: Date.now() / 1000,
                  connectionInfo: 'h2',
                  finishDocumentLoadTime: Date.now() / 1000,
                  finishLoadTime: Date.now() / 1000,
                  firstPaintAfterLoadTime: 0,
                  firstPaintTime: Date.now() / 1000,
                  navigationType: 'Other',
                  requestTime: Date.now() / 1000,
                  startLoadTime: Date.now() / 1000
                };
              };
            }
            if (!window.chrome.runtime) {
              window.chrome.runtime = {
                OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
                OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
                PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
                PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
                PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
                RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' }
              };
            }
          } catch (_) {}

          try {
            // 4. Mock navigator.plugins if empty
            if (!navigator.plugins || navigator.plugins.length === 0) {
              const dummyPlugins = [
                { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' }
              ];
              Object.defineProperty(navigator, 'plugins', {
                get: () => dummyPlugins,
                configurable: true
              });
            }
          } catch (_) {}
        })();
      `
      }
    ])
    .catch(() => {})
} catch (_) {}

import {
  WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
  type WebviewAnnotationGuestEvent,
  WebviewAnnotationHostCommandSchema
} from '@shared/types/webviewAnnotation'
import {
  isForwardableGuestKey,
  isHostOwnedGuestKey,
  toWebviewKeyPayload,
  WEBVIEW_KEYDOWN_CHANNEL
} from '@shared/utils/webviewKey'

import { WebviewAnnotationController } from './WebviewAnnotationController'

const controller = new WebviewAnnotationController(
  (event: WebviewAnnotationGuestEvent) => ipcRenderer.sendToHost(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, event),
  (event) => {
    if (event.isComposing || !isForwardableGuestKey(event)) return
    if (isHostOwnedGuestKey(event)) event.preventDefault()
    ipcRenderer.sendToHost(WEBVIEW_KEYDOWN_CHANNEL, toWebviewKeyPayload(event))
  }
)

ipcRenderer.on(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, (_event, value: unknown) => {
  const command = WebviewAnnotationHostCommandSchema.safeParse(value)
  if (command.success) controller.handleCommand(command.data)
})

window.addEventListener('unload', () => controller.dispose(), { once: true })
