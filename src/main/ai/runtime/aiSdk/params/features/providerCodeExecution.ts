import { providerToolPlugin } from '@cherrystudio/ai-core/built-in/plugins'
import { isNativeCodeExecutionAvailable } from '@shared/ai/nativeCodeExecution'

import type { RequestFeature } from '../feature'

export const providerCodeExecutionFeature: RequestFeature = {
  name: 'provider-code-execution',
  applies: (scope) =>
    scope.assistant?.settings.enableNativeCodeExecution === true &&
    scope.aiSdkProviderId === 'xai-responses' &&
    isNativeCodeExecutionAvailable(scope.model, scope.provider),
  contributeModelAdapters: () => [providerToolPlugin('codeExecution')]
}
