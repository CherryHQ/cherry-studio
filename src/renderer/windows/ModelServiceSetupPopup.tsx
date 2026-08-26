import {
  type ModelServiceSetupRequest,
  type ModelServiceSetupResult,
  modelServiceSetupService
} from '@renderer/services/ModelServiceSetupService'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { lazy, Suspense } from 'react'

const ModelServiceSetupDialog = lazy(() =>
  import('@renderer/pages/settings/ProviderSettings').then((module) => ({
    default: module.ModelServiceSetupDialog
  }))
)

function ModelServiceSetupPopup({
  open,
  resolve,
  ...request
}: ModelServiceSetupRequest & PopupInjectedProps<ModelServiceSetupResult>) {
  return (
    <Suspense fallback={null}>
      <ModelServiceSetupDialog open={open} onResolve={resolve} {...request} />
    </Suspense>
  )
}

const modelServiceSetupPopup = createPopup<ModelServiceSetupRequest, ModelServiceSetupResult>(ModelServiceSetupPopup, {
  dismissResult: null
})

export function registerModelServiceSetupPopup(): () => void {
  return modelServiceSetupService.register((request) => modelServiceSetupPopup.show(request))
}
