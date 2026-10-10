import { useState } from 'react'

import { useProvider, useProviderMutations, useProviderPreset } from '@renderer/hooks/useProvider'
import { getProviderHostTopology } from '@shared/utils/providerTopology'

import { useProviderEndpointActions } from '../hooks/providerSetting/useProviderEndpointActions'
import { useProviderEndpoints } from '../hooks/providerSetting/useProviderEndpoints'
import { useProviderHostPreview } from '../hooks/providerSetting/useProviderHostPreview'
import { useProviderMeta } from '../hooks/providerSetting/useProviderMeta'
import { ApiHostField, ApiHostSection, AzureApiVersionField } from './ApiHostFields'
import ProviderCustomHeaderDrawer from './ProviderCustomHeaderDrawer'

const ENDPOINT_CONFIG_PRESET_FIELDS = ['endpointConfigs'] as const

interface ApiHostProps {
  providerId: string
  onRequestModelPullGuide?: () => void
}

export default function ApiHost({ providerId, onRequestModelPullGuide }: ApiHostProps) {
  const { provider } = useProvider(providerId)
  const { updateProvider } = useProviderMutations(providerId)
  const [customHeaderOpen, setCustomHeaderOpen] = useState(false)
  const [apiHostEdited, setApiHostEdited] = useState(false)
  const meta = useProviderMeta(providerId)
  const { apiHost, setApiHost, apiVersion, setApiVersion } = useProviderEndpoints(provider)
  const topology = getProviderHostTopology(provider)
  const { data: preset } = useProviderPreset(providerId, ENDPOINT_CONFIG_PRESET_FIELDS)
  // Factory-default host for the primary endpoint (registry-sourced); '' for custom providers.
  const defaultApiHost = preset?.endpointConfigs?.[topology.primaryEndpoint]?.baseUrl ?? ''
  const hostPreview = useProviderHostPreview({
    provider,
    apiHost,
    defaultApiHost
  })
  const endpointActions = useProviderEndpointActions({
    provider,
    primaryEndpoint: topology.primaryEndpoint,
    apiHost,
    setApiHost,
    providerApiHost: topology.primaryBaseUrl,
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
      <ApiHostSection id="setting-provider-api-host">
        <ApiHostField
          providerIdForSettings={provider.id}
          apiHost={apiHost}
          hostPreview={hostPreview.hostPreview}
          isCherryIN={meta.isCherryIN}
          isChineseUser={meta.isChineseUser}
          isVertexAI={provider.id === 'vertexai'}
          isApiHostResettable={hostPreview.isApiHostResettable}
          onApiHostChange={handleApiHostChange}
          onApiHostCommit={() => void handleApiHostCommit()}
          onResetApiHost={endpointActions.resetApiHost}
          onOpenRequestConfig={() => setCustomHeaderOpen(true)}
        />
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
