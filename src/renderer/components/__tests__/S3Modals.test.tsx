import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getI18n } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { S3RestoreModal } from '../S3Modals'

vi.unmock('@cherrystudio/ui')

describe('S3RestoreModal', () => {
  afterEach(async () => {
    await getI18n().changeLanguage('en-us')
  })

  it('shows a translated empty message when no backup files are listed', async () => {
    await getI18n().changeLanguage('zh-cn')
    render(
      <S3RestoreModal
        isRestoreModalVisible
        handleRestore={vi.fn()}
        handleCancel={vi.fn()}
        restoring={false}
        selectedFile={null}
        setSelectedFile={vi.fn()}
        loadingFiles={false}
        backupFiles={[]}
        showRestoreModal={vi.fn()}
      />
    )

    await userEvent.setup().click(screen.getByRole('button', { name: '请选择要恢复的备份文件' }))

    expect(await screen.findByText('无结果')).toBeInTheDocument()
    expect(screen.queryByText('No results found.')).toBeNull()
  })
})
