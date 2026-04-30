import { useProvider, useProviderMutations } from '@renderer/hooks/useProviders'
import { getProviderHostTopology } from '@renderer/pages/settings/ProviderSettingsV2/utils/providerTopology'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { useState } from 'react'

import { useProviderEndpointActions } from '../hooks/providerSetting/useProviderEndpointActions'
import { useProviderEndpoints } from '../hooks/providerSetting/useProviderEndpoints'
import { useProviderHostPreview } from '../hooks/providerSetting/useProviderHostPreview'
import { useProviderMeta } from '../hooks/providerSetting/useProviderMeta'
import { useProviderModelSync } from '../hooks/useProviderModelSync'
import { AnthropicApiHostField, ApiHostField, ApiHostSection, AzureApiVersionField } from './ApiHostFields'
import ProviderCustomHeaderDrawer from './ProviderCustomHeaderDrawer'

interface ApiHostProps {
  providerId: string
}

export default function ApiHost({ providerId }: ApiHostProps) {
  const { provider } = useProvider(providerId)
  const { updateProvider } = useProviderMutations(providerId)
  const [customHeaderOpen, setCustomHeaderOpen] = useState(false)
  const meta = useProviderMeta(providerId)
  const {
    primaryEndpoint,
    apiHost,
    setApiHost,
    anthropicApiHost,
    setAnthropicApiHost,
    apiVersion,
    setApiVersion,
    isVertexProvider
  } = useProviderEndpoints(provider)
  const { syncProviderModels } = useProviderModelSync(providerId)
  const topology = getProviderHostTopology(provider)
  const isAnthropicPrimaryEndpoint = primaryEndpoint === ENDPOINT_TYPE.ANTHROPIC_MESSAGES
  const hostPreview = useProviderHostPreview({
    provider,
    apiHost,
    anthropicApiHost
  })
  const endpointActions = useProviderEndpointActions({
    provider,
    primaryEndpoint: topology.primaryEndpoint,
    apiHost,
    setApiHost,
    providerApiHost: topology.primaryBaseUrl,
    anthropicApiHost,
    setAnthropicApiHost,
    apiVersion,
    patchProvider: updateProvider,
    syncProviderModels
  })

  if (!provider) {
    return null
  }

  if (!meta.isConnectionFieldVisible) {
    return meta.isAzureOpenAI ? (
      <ApiHostSection>
        <AzureApiVersionField
          apiVersion={apiVersion}
          onApiVersionChange={setApiVersion}
          onApiVersionCommit={endpointActions.commitApiVersion}
        />
      </ApiHostSection>
    ) : null
  }

  return (
    <>
      <ApiHostSection>
        {!isAnthropicPrimaryEndpoint ? (
          <ApiHostField
            providerIdForSettings={provider.id}
            apiHost={apiHost}
            isCherryIN={meta.isCherryIN}
            isChineseUser={meta.isChineseUser}
            isVertexAI={provider.id === 'vertexai'}
            isApiHostResettable={hostPreview.isApiHostResettable}
            onResetApiHost={endpointActions.resetApiHost}
            onOpenRequestConfig={() => setCustomHeaderOpen(true)}
          />
        ) : (
          <AnthropicApiHostField
            anthropicApiHost={anthropicApiHost}
            anthropicHostPreview={hostPreview.anthropicHostPreview}
            onOpenRequestConfig={() => setCustomHeaderOpen(true)}
          />
        )}
        {meta.isAzureOpenAI && (
          <AzureApiVersionField
            className="mt-4"
            apiVersion={apiVersion}
            onApiVersionChange={setApiVersion}
            onApiVersionCommit={endpointActions.commitApiVersion}
          />
        )}
      </ApiHostSection>
      <ProviderCustomHeaderDrawer
        providerId={providerId}
        open={customHeaderOpen}
        onClose={() => setCustomHeaderOpen(false)}
        hostEditMode={isAnthropicPrimaryEndpoint ? 'anthropic' : 'primary'}
        apiHost={apiHost}
        anthropicApiHost={anthropicApiHost}
        commitApiHost={endpointActions.commitApiHost}
        commitAnthropicApiHost={endpointActions.commitAnthropicApiHost}
        isVertexProvider={isVertexProvider}
      />
    </>
  )
}
