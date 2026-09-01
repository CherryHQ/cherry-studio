import { application } from '@application'
import { loggerService } from '@logger'
import type {
  LocalModelBundleId,
  LocalModelCapability,
  LocalModelDownloadResult,
  LocalModelStatusSnapshot
} from '@shared/data/presets/localModel'
import { LOCAL_MODEL_STATUS_CACHE_KEY } from '@shared/data/presets/localModel'

import { capabilityHooksFor } from './capabilities/capabilityHooks'
import { ALL_MODEL_BUNDLE_IDS, bundleForCapability, getModelBundle } from './catalog/catalog'
import type { SharedArtifactId } from './catalog/types'
import { BundleInstaller, type ResolveDownloadSourcePreference } from './installation/BundleInstaller'
import { localModelStorageService } from './installation/LocalModelStorageService'
import { isLocalInferenceHardwareAccelerationSupported } from './runtime/inferenceAcceleration'

const logger = loggerService.withContext('LocalModelService')

export class LocalModelService {
  private readonly installers = Object.fromEntries(
    ALL_MODEL_BUNDLE_IDS.map((id) => {
      const bundle = getModelBundle(id)
      return [
        id,
        new BundleInstaller(
          bundle,
          capabilityHooksFor(bundle.capability),
          (snapshot) => this.publishStatus(id, snapshot),
          () => this.gcSharedArtifacts()
        )
      ]
    })
  ) as Record<LocalModelBundleId, BundleInstaller>

  listModels(): Array<{ id: LocalModelBundleId; capability: LocalModelCapability }> {
    return ALL_MODEL_BUNDLE_IDS.map((id) => ({ id, capability: getModelBundle(id).capability }))
  }

  refreshStatus(id: LocalModelBundleId): ReturnType<BundleInstaller['getStatusInfo']> {
    const snapshot = this.installerFor(id).getStatusSnapshot()
    this.publishStatus(id, snapshot)
    return snapshot.errorCode ? { status: snapshot.status, errorCode: snapshot.errorCode } : { status: snapshot.status }
  }

  download(
    id: LocalModelBundleId,
    resolvePreference: ResolveDownloadSourcePreference
  ): Promise<LocalModelDownloadResult> {
    return this.installerFor(id).download(resolvePreference)
  }

  async cancel(id: LocalModelBundleId): Promise<void> {
    await this.installerFor(id).cancel()
  }

  async remove(id: LocalModelBundleId): Promise<Awaited<ReturnType<BundleInstaller['remove']>>> {
    return this.installerFor(id).remove()
  }

  isReady(capability: LocalModelCapability): boolean {
    return this.installerFor(bundleForCapability(capability).id).getStatus() === 'ready'
  }

  isHardwareAccelerationSupported(): boolean {
    return isLocalInferenceHardwareAccelerationSupported()
  }

  private installerFor(id: LocalModelBundleId): BundleInstaller {
    return this.installers[id]
  }

  private publishStatus(id: LocalModelBundleId, snapshot: LocalModelStatusSnapshot): void {
    const cacheService = application.get('CacheService')
    const snapshots = cacheService.getShared(LOCAL_MODEL_STATUS_CACHE_KEY) ?? {}
    cacheService.setShared(LOCAL_MODEL_STATUS_CACHE_KEY, { ...snapshots, [id]: snapshot })
  }

  private async gcSharedArtifacts(): Promise<void> {
    const known = new Set<SharedArtifactId>()
    const stillNeeded = new Set<SharedArtifactId>()

    for (const id of ALL_MODEL_BUNDLE_IDS) {
      const installed = localModelStorageService.scanBundleFiles(getModelBundle(id)).status === 'installed'
      for (const artifact of getModelBundle(id).requires) {
        known.add(artifact)
        if (installed) stillNeeded.add(artifact)
      }
    }

    for (const artifact of known) {
      if (stillNeeded.has(artifact)) continue
      try {
        await localModelStorageService.removeArtifactIfUnused(artifact)
      } catch (error) {
        logger.warn('failed to remove an unused shared runtime', { artifact, error: String(error) })
      }
    }
  }
}

export const localModelService = new LocalModelService()
