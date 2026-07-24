import { useProvider, useProviderMutations } from '@renderer/hooks/useProvider'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { getProviderHostTopology } from '@shared/utils/providerTopology'
import { useRef, useState } from 'react'

import { useProviderEndpointActions } from '../hooks/providerSetting/useProviderEndpointActions'
import { useProviderEndpoints } from '../hooks/providerSetting/useProviderEndpoints'
import { useProviderHostPreview } from '../hooks/providerSetting/useProviderHostPreview'
import { useProviderMeta } from '../hooks/providerSetting/useProviderMeta'
import { AnthropicApiHostField, ApiHostField, ApiHostSection, AzureApiVersionField } from './ApiHostFields'
import type { ConnectionModelDetectionEvent } from './connectionModelDetection'
import ProviderCustomHeaderDrawer from './ProviderCustomHeaderDrawer'

interface ApiHostProps {
  providerId: string
  onConnectionModelDetection?: (event: ConnectionModelDetectionEvent) => void
}

export default function ApiHost({ providerId, onConnectionModelDetection }: ApiHostProps) {
  const { provider } = useProvider(providerId)
  const { updateProvider } = useProviderMutations(providerId)
  const [customHeaderOpen, setCustomHeaderOpen] = useState(false)
  const apiHostEditedRef = useRef(false)
  const anthropicApiHostEditedRef = useRef(false)
  const meta = useProviderMeta(providerId)
  const { primaryEndpoint, apiHost, setApiHost, anthropicApiHost, setAnthropicApiHost, apiVersion, setApiVersion } =
    useProviderEndpoints(provider)
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
    patchProvider: updateProvider
  })
  const handleApiHostChange = (value: string) => {
    if (!apiHostEditedRef.current) {
      apiHostEditedRef.current = true
      onConnectionModelDetection?.({ intent: 'invalidate' })
    }
    setApiHost(value)
  }
  const handleApiHostCommit = async () => {
    const wasChanged = apiHostEditedRef.current
    const committed = await endpointActions.commitApiHost()
    if (committed) {
      apiHostEditedRef.current = false
      onConnectionModelDetection?.({
        intent: 'detect',
        ...(wasChanged ? { shouldGuideExistingModels: true } : {})
      })
    }
  }
  const handleAnthropicApiHostChange = (value: string) => {
    if (!anthropicApiHostEditedRef.current) {
      anthropicApiHostEditedRef.current = true
      onConnectionModelDetection?.({ intent: 'invalidate' })
    }
    setAnthropicApiHost(value)
  }
  const handleAnthropicApiHostCommit = async () => {
    const wasChanged = anthropicApiHostEditedRef.current
    const committed = await endpointActions.commitAnthropicApiHost()
    if (committed) {
      anthropicApiHostEditedRef.current = false
      onConnectionModelDetection?.({
        intent: 'detect',
        ...(wasChanged ? { shouldGuideExistingModels: true } : {})
      })
    }
  }
  const handleResetApiHost = async () => {
    apiHostEditedRef.current = true
    onConnectionModelDetection?.({ intent: 'invalidate' })
    const committed = await endpointActions.resetApiHost()
    if (committed) {
      apiHostEditedRef.current = false
      onConnectionModelDetection?.({
        intent: 'detect',
        shouldGuideExistingModels: true
      })
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
            onResetApiHost={() => void handleResetApiHost()}
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
