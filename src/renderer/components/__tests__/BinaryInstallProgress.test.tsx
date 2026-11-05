import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { BinaryInstallFailureRow, BinaryInstallingHint } from '../BinaryInstallErrorDialog'

describe('BinaryInstallingHint', () => {
  it('shows the current stage with the version transition', () => {
    render(
      <BinaryInstallingHint
        operation={{ status: 'installing', stage: 'downloading', currentVersion: '1.0.0', targetVersion: '2.0.0' }}
      />
    )

    expect(screen.getByRole('status').textContent).toBe('下载中 · 1.0.0 → 2.0.0')
  })

  it('falls back to the generic hint when no stage is published', () => {
    render(<BinaryInstallingHint operation={{ status: 'installing' }} />)

    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText(/首次安装/)).toBeTruthy()
  })
})

describe('BinaryInstallFailureRow', () => {
  it('names the failed stage so a failed download differs from a failed install', () => {
    const { rerender } = render(<BinaryInstallFailureRow error="boom" stage="downloading" onShowError={() => {}} />)
    expect(screen.getByRole('button').textContent).toContain('失败阶段：下载中')

    rerender(<BinaryInstallFailureRow error="boom" onShowError={() => {}} />)
    expect(screen.getByRole('button').textContent).not.toContain('失败阶段：下载中')
  })
})
