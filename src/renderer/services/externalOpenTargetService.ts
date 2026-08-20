import { cacheService } from '@data/CacheService'
import { ipcApi } from '@renderer/ipc'
import type { ExternalOpenTargetResult } from '@shared/types/externalApp'

export type ExternalOpenTargetPathKind = ExternalOpenTargetResult['pathKind']

export function getExternalOpenTargetScope(targetPath: string, pathKind: ExternalOpenTargetPathKind): string {
  if (pathKind === 'directory') return 'directory'

  const fileName = targetPath.split(/[/\\]/).at(-1) ?? targetPath
  const dotIndex = fileName.lastIndexOf('.')
  const extension = dotIndex > 0 && dotIndex < fileName.length - 1 ? fileName.slice(dotIndex + 1).toLowerCase() : null
  return `file:${extension ?? 'no_extension'}`
}

class ExternalOpenTargetService {
  list(targetPath: string): Promise<ExternalOpenTargetResult> {
    return ipcApi.request('external_app.target.list', { targetPath })
  }

  async open(targetPath: string, pathKind: ExternalOpenTargetPathKind, targetId: string): Promise<void> {
    await ipcApi.request('external_app.target.open', { targetPath, targetId })
    const scope = getExternalOpenTargetScope(targetPath, pathKind)
    cacheService.setPersist('external_app.target.preferences', (preferences) => ({
      ...preferences,
      [scope]: targetId
    }))
  }
}

export const externalOpenTargetService = new ExternalOpenTargetService()
