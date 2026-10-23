import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ProviderSchema } from '@shared/data/types/provider'

import bundledProviders from '../../../../../../../../packages/provider-registry/data/providers.json'
import { ModelConnectionDetails } from '../ModelConnectionDetails'

afterEach(cleanup)

describe('model connection details', () => {
  it.each(['vertexai', 'aws-bedrock'])('does not warn about SDK-derived addresses for %s', (id) => {
    const preset = bundledProviders.providers.find((provider) => provider.id === id)
    expect(preset).toBeDefined()
    const provider = ProviderSchema.parse({
      ...preset,
      settings: {},
      apiKeys: [],
      authType: 'api-key',
      reportsActualCost: false,
      isEnabled: true
    })
    render(<ModelConnectionDetails provider={provider} endpoints={[]} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('still warns when an API-key transport has no compatible connection', () => {
    const provider = ProviderSchema.parse({
      id: 'custom',
      name: 'Custom',
      settings: {},
      apiKeys: [],
      authType: 'api-key',
      reportsActualCost: false,
      isEnabled: true,
      defaultChatEndpoint: 'google-generate-content',
      endpointConfigs: { 'google-generate-content': { adapterFamily: 'google' } }
    })
    render(<ModelConnectionDetails provider={provider} endpoints={[]} />)
    expect(screen.getByRole('alert')).toBeVisible()
  })
})
