import { render, screen, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConversationHandoff } from '@renderer/components/chat/shell/ConversationHandoff'
import { ipcApi } from '@renderer/ipc'
import type { Model } from '@shared/data/types/model'

import { useHandoffContextPercentage } from '../useHandoffContextPercentage'

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: [] }),
  getProviderDisplayName: () => ''
}))
const models = [
  { id: 'provider::a', contextWindow: 100 },
  { id: 'provider::b', contextWindow: 200 }
] as Model[]
function Harness({ enabled = true, candidates = models }: { enabled?: boolean; candidates?: Model[] }) {
  const { percentage } = useHandoffContextPercentage({
    enabled,
    topicId: 'topic',
    anchorId: 'branch',
    fillsAnchor: false,
    candidates,
    revision: 1
  })
  return (
    <ConversationHandoff sessionId="multi-estimate" hasMessages modelCandidates={candidates} percentage={percentage} />
  )
}
describe('multi-model handoff estimate', () => {
  beforeEach(() => vi.clearAllMocks())
  it('shows the offer when either selected model exceeds 80%, without generating a handoff', async () => {
    vi.mocked(ipcApi.request).mockImplementation(async (_route, input) =>
      (input as { modelId: string }).modelId === 'provider::a' ? 20 : 170
    )
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <Harness />
      </SWRConfig>
    )
    expect(await screen.findByRole('status')).toHaveTextContent('handoff.offer')
    expect(ipcApi.request).toHaveBeenCalledTimes(2)
    for (const call of vi.mocked(ipcApi.request).mock.calls) expect(call[0]).toBe('ai.topic.estimate_context')
  })
  it('hides the offer when preview is disabled or candidate estimates change', async () => {
    vi.mocked(ipcApi.request).mockResolvedValue(85)
    const view = render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <Harness />
      </SWRConfig>
    )
    expect(await screen.findByRole('status')).toBeVisible()
    view.rerender(
      <SWRConfig value={{ provider: () => new Map() }}>
        <Harness enabled={false} />
      </SWRConfig>
    )
    expect(screen.queryByRole('status')).toBeNull()
    view.rerender(
      <SWRConfig value={{ provider: () => new Map() }}>
        <Harness candidates={[models[1]]} />
      </SWRConfig>
    )
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })
  it('still warns for a known high candidate when another estimate fails', async () => {
    vi.mocked(ipcApi.request).mockImplementation(async (_route, input) => {
      if ((input as { modelId: string }).modelId === 'provider::a') throw new Error('unavailable')
      return 170
    })
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <Harness />
      </SWRConfig>
    )
    expect(await screen.findByRole('status')).toBeVisible()
  })
})
