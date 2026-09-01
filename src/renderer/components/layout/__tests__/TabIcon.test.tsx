// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { Tab } from '@renderer/hooks/tab'
import { MINI_APP_ROUTE_PREFIX } from '@renderer/utils/miniAppKeepAlive'
import { render } from '@testing-library/react'
import type { SVGProps } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/components/icons/miniAppsLogo', () => {
  const PresetLogo = (props: SVGProps<SVGSVGElement>) => <svg {...props} />
  PresetLogo.Avatar = ({ size }: { size: number }) => (
    <svg data-testid="preset-logo" style={{ width: size, height: size }} />
  )

  return {
    getMiniAppsLogoRef: (icon?: string) => (icon === 'felo' ? { key: icon } : undefined),
    useMiniAppLogo: (icon?: string) => (icon === 'felo' ? PresetLogo : undefined)
  }
})

import { TabIcon } from '../TabIcon'

const createTab = (overrides: Partial<Tab>): Tab => ({
  id: 'tab-1',
  type: 'route',
  url: '/app/chat',
  title: 'Test tab',
  ...overrides
})

describe('TabIcon', () => {
  it('insets an uploaded Mini App logo within the tab icon slot', () => {
    const { container } = render(
      <TabIcon
        tab={createTab({ url: `${MINI_APP_ROUTE_PREFIX}custom-app`, icon: 'file:///files/custom.webp' })}
        size={25}
      />
    )

    expect(container.firstElementChild).toHaveStyle({ width: '25px', height: '25px' })
    expect(container.querySelector('img')).toHaveStyle({ width: '20px', height: '20px' })
  })

  it('keeps preset Mini App logos at the requested size', () => {
    const { getByTestId } = render(
      <TabIcon tab={createTab({ url: `${MINI_APP_ROUTE_PREFIX}felo`, icon: 'felo' })} size={25} />
    )

    expect(getByTestId('preset-logo')).toHaveStyle({ width: '25px', height: '25px' })
  })

  it('keeps ordinary image tab icons at the requested size', () => {
    const { container } = render(
      <TabIcon
        tab={createTab({ type: 'webview', url: 'https://example.com', icon: 'https://example.com/icon.png' })}
        size={25}
      />
    )

    expect(container.querySelector('img')).toHaveStyle({ width: '25px', height: '25px' })
  })
})
