import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'

/** Pure Azure runtime choice shared by configuration and native-media budgeting. */
export function usesAzureAnthropicRuntime(modelId: string, endpointType?: EndpointType): boolean {
  return modelId.startsWith('claude') || endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES
}
