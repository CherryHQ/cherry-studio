// Browser stand-in for `electron`. `BaseService` imports `ipcMain` and the i18n resolver reads
// `app.getLocale()`; nothing else is exported, so a new Electron import fails the build.
const unavailable = (api: string) => () => {
  throw new Error(`electron ${api} is not available in the Web Core Worker`)
}

export const ipcMain = {
  handle: unavailable('ipcMain.handle()'),
  removeHandler: unavailable('ipcMain.removeHandler()'),
  on: unavailable('ipcMain.on()'),
  removeListener: unavailable('ipcMain.removeListener()')
}

const appApi: Record<string, unknown> = {
  getLocale: () => navigator.language
}

export const app = new Proxy(appApi, {
  get(target, property) {
    if (typeof property === 'string' && property in target) return target[property]
    throw new Error(`electron app.${String(property)} is not available in the Web Core Worker`)
  }
})

export type IpcMainEvent = never
export type IpcMainInvokeEvent = never
