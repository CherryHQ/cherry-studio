import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

import { AppMarkdown } from '../AppMarkdown'
import { MarkdownHostProvider } from '../MarkdownHostProvider'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())
vi.mock('react-i18next', () => {
  const t = (key: string) => key
  return { useTranslation: () => ({ t }) }
})

const table = '| Name | Value |\n| --- | --- |\n| Result | 42 |'

describe('Markdown table host capabilities', () => {
  it('copies only the table source and exports its rendered cells', async () => {
    const user = userEvent.setup()
    const copyRichContent = vi.fn()
    const exportTableAsExcel = vi.fn().mockResolvedValue(true)
    render(
      <MarkdownHostProvider copyRichContent={copyRichContent} exportTableAsExcel={exportTableAsExcel}>
        <AppMarkdown>{`Before\n\n${table}\n\nAfter`}</AppMarkdown>
      </MarkdownHostProvider>
    )
    await user.click(screen.getByRole('button', { name: 'common.copy' }))
    expect(copyRichContent).toHaveBeenCalledWith(
      { plainText: table, html: expect.stringContaining('<td>42</td>') },
      { successMessage: 'message.copied' }
    )
    await user.click(screen.getByRole('button', { name: 'common.export.excel' }))
    expect(exportTableAsExcel).toHaveBeenCalledWith([
      ['Name', 'Value'],
      ['Result', '42']
    ])
  })

  it('shows table content without actions when no host provides them', () => {
    render(<AppMarkdown>{table}</AppMarkdown>)
    expect(screen.getByRole('cell', { name: '42' })).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('reports a failed copy and permits retry', async () => {
    const user = userEvent.setup()
    const copyRichContent = vi
      .fn()
      .mockRejectedValueOnce(new Error('Clipboard unavailable'))
      .mockResolvedValue(undefined)
    const notifyError = vi.fn()
    render(
      <MarkdownHostProvider copyRichContent={copyRichContent} notifyError={notifyError}>
        <AppMarkdown>{table}</AppMarkdown>
      </MarkdownHostProvider>
    )
    await user.click(screen.getByRole('button', { name: 'common.copy' }))
    expect(notifyError).toHaveBeenCalledWith('message.copy.failed')
    await user.click(screen.getByRole('button', { name: 'common.copy' }))
    expect(copyRichContent).toHaveBeenLastCalledWith(
      { plainText: table, html: expect.stringContaining('<td>42</td>') },
      { successMessage: 'message.copied' }
    )
    expect(copyRichContent).toHaveBeenCalledTimes(2)
  })
})
