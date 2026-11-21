import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import { createMiniApp } from '@renderer/hooks/__tests__/fixtures/miniApp'
import zhCN from '@renderer/i18n/locales/zh-cn.json'

import MiniApp from '../MiniApp'

vi.unmock('@cherrystudio/ui')

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  MockUsePreferenceUtils.resetMocks()
})

it('shows the selected country and the localized Default option in the real region submenu', async () => {
  const request = vi.spyOn(window.api.ipcApi, 'request').mockResolvedValue({ ok: true, data: undefined })
  const i18n = createInstance()
  await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: zhCN } }, keySeparator: false })
  MockUsePreferenceUtils.setMultiplePreferenceValues({
    'app.developer_mode.enabled': true,
    'feature.mini_app.fake_environment.enabled': true,
    'feature.mini_app.region_profiles': { a: 'JP' }
  })
  render(
    <I18nextProvider i18n={i18n}>
      <MiniApp
        app={createMiniApp('a', { name: 'Regional test site' })}
        variant="launchpad"
        onOpen={vi.fn()}
        onUpdateStatus={vi.fn()}
        onHide={vi.fn()}
        onRemoveCustom={vi.fn()}
        onToggleSidebarFavorite={vi.fn()}
        isPinned={false}
        isSidebarFavorite={false}
        isOpened={false}
        isActive={false}
      />
    </I18nextProvider>
  )
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Regional test site' }))
  fireEvent.keyDown(screen.getByRole('menuitem', { name: '环境 · 日本（东京）' }), { key: 'ArrowRight' })

  const japan = await screen.findByRole('menuitemcheckbox', { name: '使用日本（东京）', checked: true })
  expect(japan.querySelector('svg')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '默认', checked: false }))
  await waitFor(() => expect(request).toHaveBeenCalledWith('webview.region.set_country', { appId: 'a', country: null }))
})
