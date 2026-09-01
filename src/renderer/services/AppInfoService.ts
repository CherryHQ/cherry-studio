import { ipcApi } from '@renderer/ipc'
import type { OutputFor } from '@shared/ipc/types'

type AppInfo = OutputFor<'app.get_info'>

class AppInfoService {
  private info: AppInfo | undefined
  private pending: Promise<AppInfo> | undefined

  preload(): Promise<AppInfo> {
    if (this.info) return Promise.resolve(this.info)

    if (!this.pending) {
      this.pending = ipcApi
        .request('app.get_info')
        .then((info) => {
          this.info = info
          return info
        })
        .finally(() => {
          this.pending = undefined
        })
    }

    return this.pending
  }

  get(): AppInfo {
    if (!this.info) {
      throw new Error('App info must be preloaded before rendering')
    }
    return this.info
  }
}

export const appInfoService = new AppInfoService()
