import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'

import { UserAccountPanel } from '../UserAccountPanel'

vi.mock('@renderer/hooks/useCherryAccountSession', () => ({
  useCherryAccountSession: () => ({
    status: { phase: 'signed-in', displayName: 'c***@cherry-ai.com' },
    loadState: 'ready',
    revokeSession: vi.fn(),
    isCancellingLogin: false,
    isRevokingSession: false,
    isAuthorizing: false
  })
}))

describe('UserAccountPanel', () => {
  beforeEach(async () => {
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('app.user.name', '')
    await i18n.changeLanguage('zh-CN')
  })

  it('shows the signed-in email without a name prompt in the global account menu', () => {
    vi.stubGlobal('__APP_EDITION__', 'global')

    render(<UserAccountPanel />)

    expect(screen.getByRole('button', { name: '用户名' })).toHaveTextContent('c***@cherry-ai.com')
    expect(screen.getAllByText('c***@cherry-ai.com')).toHaveLength(1)
    expect(screen.queryByText('输入您的姓名')).not.toBeInTheDocument()
  })

  it('keeps the local name prompt in the CN account menu', () => {
    vi.stubGlobal('__APP_EDITION__', 'cn')

    render(<UserAccountPanel />)

    expect(screen.getByText('输入您的姓名')).toBeInTheDocument()
  })
})
