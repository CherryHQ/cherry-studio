import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import enUS from '@renderer/i18n/locales/en-us.json'

vi.mock('@renderer/services/toast', (importOriginal) => importOriginal())
vi.mock('@cherrystudio/ui', async () => import('@cherrystudio/ui/components/primitives/toast'))

vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: (key: string) => enUS[key as keyof typeof enUS] ?? key }
}))

import { toast } from '@renderer/services/toast'

import { useConversationErrorToasts } from '../useConversationErrorToasts'

afterEach(() => {
  toast.closeAll()
  vi.restoreAllMocks()
  MockDataApiUtils.resetMocks()
})

const refusal = { name: 'Error', message: '429', statusCode: 429, providerErrorCategory: 'quota' }

it.each([
  { exhaustedModelIds: [], title: enUS['models.detail.quota_insufficient_for_request'] },
  { exhaustedModelIds: ['cherryai-subscription::deepseek-go'], title: enUS['models.detail.quota_exhausted'] }
])('titles a Cherry Cloud quota refusal from the latest snapshot: %j', async ({ exhaustedModelIds, title }) => {
  vi.spyOn(window.api.ipcApi, 'request').mockImplementation(async (route) =>
    route === 'cherry_cloud.account.get'
      ? { ok: true, data: { models: { freshness: 'fresh', value: { quotaExhaustedModelIds: exhaustedModelIds } } } }
      : { ok: true, data: undefined }
  )
  MockDataApiUtils.setCustomResponse('/providers/cherryai-subscription', 'GET', {
    id: 'cherryai-subscription',
    name: 'CherryAI'
  })
  const { result } = renderHook(() => useConversationErrorToasts('topic-1'))

  await act(() => result.current.report(refusal, 'cherryai-subscription::deepseek-go'))

  expect(toast.getToastQueue().toasts.at(-1)).toMatchObject({ title })
})
