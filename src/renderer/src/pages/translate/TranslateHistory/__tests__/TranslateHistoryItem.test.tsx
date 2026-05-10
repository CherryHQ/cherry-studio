import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TranslateHistoryItem } from '../TranslateHistoryItem'

vi.mock('@renderer/hooks/translate', () => ({
  useLanguages: () => ({
    getLabel: (lang: string | null) => lang ?? 'unknown'
  })
}))

vi.mock('@renderer/components/PopoverConfirm', () => {
  const React = require('react')
  const MockPopoverConfirm = ({
    children,
    onConfirm
  }: {
    children: React.ReactElement
    onConfirm: () => Promise<unknown>
  }) => {
    const [open, setOpen] = React.useState(false)
    const childProps = children.props as { onClick?: (event: React.MouseEvent) => void }
    const trigger = React.cloneElement(children, {
      onClick: (event: React.MouseEvent) => {
        childProps.onClick?.(event)
        setOpen(true)
      }
    })
    return (
      <>
        {trigger}
        {open && (
          <div onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => void onConfirm()}>
              common.confirm
            </button>
          </div>
        )}
      </>
    )
  }

  return {
    default: MockPopoverConfirm
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const historyItem = {
  id: 'hist-123',
  sourceText: 'Hello',
  targetText: '你好',
  sourceLanguage: 'en-us',
  targetLanguage: 'zh-cn',
  star: false,
  createdAt: '2026-05-10T00:00:00.000Z',
  updatedAt: '2026-05-10T00:00:00.000Z'
} as const

describe('TranslateHistoryItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stops row restore when toggling star and calls update with rethrow-off handler', async () => {
    const onClick = vi.fn()
    const onUpdate = vi.fn().mockResolvedValue(undefined)

    render(<TranslateHistoryItem data={historyItem as any} onClick={onClick} onUpdate={onUpdate} onRemove={vi.fn()} />)

    fireEvent.click(screen.getAllByRole('button')[0])

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('hist-123', { star: true }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('stops row restore when opening delete confirm and deletes only after confirmation', async () => {
    const onClick = vi.fn()
    const onRemove = vi.fn().mockResolvedValue(undefined)

    render(<TranslateHistoryItem data={historyItem as any} onClick={onClick} onUpdate={vi.fn()} onRemove={onRemove} />)

    fireEvent.click(screen.getAllByRole('button')[1])

    expect(onClick).not.toHaveBeenCalled()
    expect(onRemove).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('hist-123'))
    expect(onClick).not.toHaveBeenCalled()
  })
})
