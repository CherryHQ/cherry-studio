import { beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({
  node: { createVertex: vi.fn(), createVertexAnthropic: vi.fn(), createVertexMaas: vi.fn() },
  edge: { createVertex: vi.fn(), createVertexAnthropic: vi.fn(), createVertexMaas: vi.fn() }
}))

vi.mock('@ai-sdk/google-vertex', () => ({ createVertex: sdk.node.createVertex }))
vi.mock('@ai-sdk/google-vertex/edge', () => ({ createVertex: sdk.edge.createVertex }))
vi.mock('@ai-sdk/google-vertex/anthropic', () => ({ createVertexAnthropic: sdk.node.createVertexAnthropic }))
vi.mock('@ai-sdk/google-vertex/anthropic/edge', () => ({ createVertexAnthropic: sdk.edge.createVertexAnthropic }))
vi.mock('@ai-sdk/google-vertex/maas', () => ({ createVertexMaas: sdk.node.createVertexMaas }))
vi.mock('@ai-sdk/google-vertex/maas/edge', () => ({ createVertexMaas: sdk.edge.createVertexMaas }))

import { GoogleVertexAnthropicExtension, GoogleVertexExtension, GoogleVertexMaaSExtension } from '../extensions'

// A Google sign-in only works through the Node build (google-auth-library); service-account keys stay on edge.
describe.each([
  { extension: GoogleVertexExtension, factory: 'createVertex' },
  { extension: GoogleVertexAnthropicExtension, factory: 'createVertexAnthropic' },
  { extension: GoogleVertexMaaSExtension, factory: 'createVertexMaas' }
] as const)('$extension.config.name SDK build', ({ extension, factory }) => {
  const create = extension.config.create as (settings: Record<string, unknown>) => Promise<unknown>

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the Node build when googleAuthOptions are given', async () => {
    const settings = { project: 'p', location: 'global', googleAuthOptions: { authClient: {} } }

    await create(settings)

    expect(sdk.node[factory]).toHaveBeenCalledWith(settings)
    expect(sdk.edge[factory]).not.toHaveBeenCalled()
  })

  it('keeps service-account keys on the edge build', async () => {
    const settings = { project: 'p', location: 'global', googleCredentials: { clientEmail: 'sa@x', privateKey: 'k' } }

    await create(settings)

    expect(sdk.edge[factory]).toHaveBeenCalledWith(settings)
    expect(sdk.node[factory]).not.toHaveBeenCalled()
  })
})
