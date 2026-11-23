import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import type { AbsoluteFilePath } from '@shared/types/file'

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))

import ElectronFilePreview from '../ElectronFilePreview'

describe('ElectronFilePreview error detail inside the package preview', () => {
  // The package wraps its content in its own i18next instance, which has no app keys.
  it('labels Details with the app translation, not the raw key', async () => {
    render(
      <ElectronFilePreview
        filePath={'/tmp/report.pdf' as AbsoluteFilePath}
        fileName="report.pdf"
        metadata={{ size: 128, modifiedAt: 1 }}
        metadataRequest={async () => null}
        refreshKey={0}
      />
    )

    const detail = await screen.findByRole('button', { name: i18n.t('common.detail') })
    expect(detail).toHaveTextContent(i18n.t('common.detail'))
    expect(screen.queryByText('common.detail')).not.toBeInTheDocument()
  })
})
