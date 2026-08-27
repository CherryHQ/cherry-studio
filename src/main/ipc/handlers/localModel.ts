import { isLocalInferenceHardwareAccelerationSupported } from '@main/ai/inference/inferenceAcceleration'
import { ALL_MODEL_BUNDLE_IDS, gcSharedArtifacts, getModelBundle, installerFor } from '@main/ai/localModel'
import type { localModelRequestSchemas } from '@shared/ipc/schemas/localModel'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Thin adapters for local model routes. Every lifecycle route resolves its bundle
 * through the registry, so a new model is a catalog entry rather than a new route.
 * `download` resolves only when the download finishes.
 */
export const localModelHandlers: IpcHandlersFor<typeof localModelRequestSchemas> = {
  'local_model.get_acceleration_capability': async () => ({
    supported: isLocalInferenceHardwareAccelerationSupported()
  }),
  'local_model.list': async () => ({
    models: ALL_MODEL_BUNDLE_IDS.map((id) => ({ id, capability: getModelBundle(id).capability }))
  }),
  'local_model.get_status': async ({ id }) => installerFor(id).getStatusInfo(),
  'local_model.download': async ({ id }) => {
    try {
      const result = await installerFor(id).download()
      // A cancelled download may have installed a shared runtime nothing now uses; a
      // half-installed runtime would otherwise read as ready to the next status query.
      if (result === 'cancelled') await gcSharedArtifacts()
      return { result }
    } catch (error) {
      // Same cleanup on failure. The model files are deliberately left alone — a failed
      // download never writes partials, so whatever is on disk is a complete earlier one.
      await gcSharedArtifacts()
      throw error
    }
  },
  'local_model.cancel': async ({ id }) => installerFor(id).cancel(),
  'local_model.remove': async ({ id }) => {
    const result = await installerFor(id).remove()
    // Only this bundle's own files are gone here; a shared runtime survives exactly as
    // long as another installed bundle still requires it.
    await gcSharedArtifacts()
    return result
  }
}
