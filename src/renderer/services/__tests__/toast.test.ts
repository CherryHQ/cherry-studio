import { afterEach, describe, expect, it, vi } from 'vitest'

import enUS from '@renderer/i18n/locales/en-us.json'

vi.mock('@renderer/services/toast', (importOriginal) => importOriginal())
vi.mock('@cherrystudio/ui', async () => import('@cherrystudio/ui/components/primitives/toast'))

vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: (key: string) => enUS[key as keyof typeof enUS] ?? key }
}))

import { toast } from '../toast'

afterEach(() => toast.closeAll())

describe('provider entitlement toasts', () => {
  it('shows permission without a billing action and preserves real quota recovery', () => {
    const provider = { id: 'groq', name: 'Groq' }
    const message = `service_tier auto is not available for this org. You can check your plan at
[Billing - Plans](https://console.groq.com/settings/billing/plans), and upgrade to access the
required service tier.`
    const permissionKey = toast.errorFromException({ name: 'Error', message, statusCode: 400 }, { provider })
    const quotaKey = toast.errorFromException(
      { name: 'Error', message: 'insufficient_quota', statusCode: 429 },
      { provider }
    )
    const { toasts } = toast.getToastQueue()
    expect(toasts.find((item) => item.key === permissionKey)).toMatchObject({
      title: enUS['error.diagnosis.permission'],
      action: undefined
    })
    expect(toasts.find((item) => item.key === quotaKey)).toMatchObject({
      title: enUS['error.diagnosis.quota'],
      action: { label: enUS['toast.error.configure'], onClick: expect.any(Function) }
    })
  })
})
