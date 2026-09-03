import { workerCoreSource } from './workerCore'

/**
 * Builds one eval'd worker from the shared host core, one runtime module and one capability module.
 * electron-vite's single main-process chunk cannot emit a separate worker entry, so both
 * pieces remain source strings until the host can move to utilityProcess.
 */
export function buildInferenceWorkerSource(runtimeModuleSource: string, capabilityModuleSource: string): string {
  return [workerCoreSource, runtimeModuleSource, capabilityModuleSource].join('\n')
}
