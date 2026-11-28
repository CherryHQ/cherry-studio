import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import zhCN from '@renderer/i18n/locales/zh-cn.json'

import BlockErrorFallback from '../BlockErrorFallback'

describe('BlockErrorFallback', () => {
  it('shows the localized render failure and keeps the raw error behind Details', () => {
    render(
      <BlockErrorFallback error={new Error('Cannot read properties of undefined')} resetErrorBoundary={() => {}} />
    )

    expect(screen.getByText(zhCN['error.render.block'])).toBeInTheDocument()
    expect(screen.getByRole('button', { name: new RegExp(zhCN['common.detail']) })).toBeInTheDocument()
    expect(screen.queryByText(/Cannot read properties of undefined/)).not.toBeInTheDocument()
  })
})
