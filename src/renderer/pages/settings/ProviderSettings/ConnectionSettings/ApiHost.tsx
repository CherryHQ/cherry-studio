import { useProvider, useProviderMutations, useProviderPresetEndpointConfigs } from '@renderer/hooks/useProvider'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { getProviderHostTopology } from '@shared/utils/providerTopology'
import { useState } from 'react'

import { useProviderEndpointActions } from '../hooks/providerSetting/useProviderEndpointActions'
import { useProviderEndpoints } from '../hooks/providerSetting/useProviderEndpoints'
import { useProviderHostPreview } from '../hooks/providerSetting/useProviderHostPreview'
import { useProviderMeta } from '../hooks/providerSetting/useProviderMeta'
import { AnthropicApiHostField, ApiHostField, ApiHostSection, AzureApiVersionField } from './ApiHostFields'
import ProviderCustomHeaderDrawer from './ProviderCustomHeaderDrawer'

interface ApiHostProps {
  providerId: string
  onRequestModelPullGuide?: () => void
}

export default function ApiHost({ providerId, onRequestModelPullGuide }: ApiHostProps) {
  const { provider } = useProvider(providerId)
  const { updateProvider } = useProviderMutations(providerId)
  const [customHeaderOpen, setCustomHeaderOpen] = useState(false)
  const [apiHostEdited, setApiHostEdited] = useState(false)
  const [anthropicApiHostEdited, setAnthropicApiHostEdited] = useState(false)
  const meta = useProviderMeta(providerId)
  const { primaryEndpoint, apiHost, setApiHost, anthropicApiHost, setAnthropicApiHost, apiVersion, setApiVersion } =
    useProviderEndpoints(provider)
  const topology = getProviderHostTopology(provider)
  const { data: presetEndpointConfigs } = useProviderPresetEndpointConfigs(providerId)
  // Factory-default host for the primary endpoint (registry-sourced); '' for custom providers.
  const defaultApiHost = presetEndpointConfigs?.[topology.primaryEndpoint]?.baseUrl ?? ''
  const isAnthropicPrimaryEndpoint = primaryEndpoint === ENDPOINT_TYPE.ANTHROPIC_MESSAGES
  const hostPreview = useProviderHostPreview({
    provider,
    apiHost,
    anthropicApiHost,
    defaultApiHost
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
    defaultApiHost,
    patchProvider: updateProvider
  })
  const handleApiHostChange = (value: string) => {
    setApiHostEdited(true)
    setApiHost(value)
  }
  const handleApiHostCommit = async () => {
    const committed = await endpointActions.commitApiHost()
    if (committed && apiHostEdited) {
      setApiHostEdited(false)
      onRequestModelPullGuide?.()
    }
  }
  const handleAnthropicApiHostChange = (value: string) => {
    setAnthropicApiHostEdited(true)
    setAnthropicApiHost(value)
  }
  const handleAnthropicApiHostCommit = async () => {
    const committed = await endpointActions.commitAnthropicApiHost()
    if (committed && anthropicApiHostEdited) {
      setAnthropicApiHostEdited(false)
      onRequestModelPullGuide?.()
    }
  }

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
            onApiHostChange={handleApiHostChange}
            onApiHostCommit={() => void handleApiHostCommit()}
            onResetApiHost={endpointActions.resetApiHost}
            onOpenRequestConfig={() => setCustomHeaderOpen(true)}
          />
        ) : (
          <AnthropicApiHostField
            anthropicApiHost={anthropicApiHost}
            anthropicHostPreview={hostPreview.anthropicHostPreview}
            onAnthropicApiHostChange={handleAnthropicApiHostChange}
            onAnthropicApiHostCommit={() => void handleAnthropicApiHostCommit()}
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
      />
    </>
  )
}
