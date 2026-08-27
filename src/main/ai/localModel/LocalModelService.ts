import { loggerService } from '@logger'
import type { LocalModelBundleId, LocalModelCapability } from '@shared/data/presets/localModel'

import { capabilityHooksFor } from './capabilities/capabilityHooks'
import { ALL_MODEL_BUNDLE_IDS, getModelBundle } from './catalog/catalog'
import type { SharedArtifactId } from './catalog/types'
import { BundleInstaller } from './installation/BundleInstaller'
import { localModelStorageService } from './installation/LocalModelStorageService'
import { isLocalInferenceHardwareAccelerationSupported } from './runtime/inferenceAcceleration'

const logger = loggerService.withContext('LocalModelService')

export class LocalModelService {
  private readonly installers = Object.fromEntries(
    ALL_MODEL_BUNDLE_IDS.map((id) => {
      const bundle = getModelBundle(id)
      return [id, new BundleInstaller(bundle, capabilityHooksFor(bundle.capability))]
    })
  ) as Record<LocalModelBundleId, BundleInstaller>

  listModels(): Array<{ id: LocalModelBundleId; capability: LocalModelCapability }> {
    return ALL_MODEL_BUNDLE_IDS.map((id) => ({ id, capability: getModelBundle(id).capability }))
  }

  getStatusInfo(id: LocalModelBundleId): ReturnType<BundleInstaller['getStatusInfo']> {
    return this.installerFor(id).getStatusInfo()
  }

  async download(id: LocalModelBundleId): Promise<Awaited<ReturnType<BundleInstaller['download']>>> {
    try {
      const result = await this.installerFor(id).download()
      if (result === 'cancelled') await this.gcSharedArtifacts()
      return result
    } catch (error) {
      await this.gcSharedArtifacts()
      throw error
    }
  }

  cancel(id: LocalModelBundleId): void {
    this.installerFor(id).cancel()
  }

  async remove(id: LocalModelBundleId): Promise<Awaited<ReturnType<BundleInstaller['remove']>>> {
    const result = await this.installerFor(id).remove()
    await this.gcSharedArtifacts()
    return result
  }

  isReady(capability: LocalModelCapability): boolean {
    return ALL_MODEL_BUNDLE_IDS.some(
      (id) => getModelBundle(id).capability === capability && this.installerFor(id).getStatus() === 'ready'
    )
  }

  isHardwareAccelerationSupported(): boolean {
    return isLocalInferenceHardwareAccelerationSupported()
  }

  private installerFor(id: LocalModelBundleId): BundleInstaller {
    return this.installers[id]
  }

  private async gcSharedArtifacts(): Promise<void> {
    const known = new Set<SharedArtifactId>()
    const stillNeeded = new Set<SharedArtifactId>()

    for (const id of ALL_MODEL_BUNDLE_IDS) {
      const status = this.installerFor(id).getStatus()
      for (const artifact of getModelBundle(id).requires) {
        known.add(artifact)
        if (status === 'ready' || status === 'downloading') stillNeeded.add(artifact)
      }
    }

    for (const artifact of known) {
      if (stillNeeded.has(artifact)) continue
      try {
        await localModelStorageService.removeArtifact(artifact)
      } catch (error) {
        logger.warn('failed to remove an unused shared runtime', { artifact, error: String(error) })
      }
    }
  }
}

export const localModelService = new LocalModelService()
