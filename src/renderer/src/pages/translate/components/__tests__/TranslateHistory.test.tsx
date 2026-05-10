import { parsePersistedLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateHistory as TranslateHistoryItem, TranslateLanguage } from '@shared/data/types/translate'
import { render, screen } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TranslateHistory from '../TranslateHistory'

const translateHistoryMock = vi.hoisted(() => ({
  useTranslateHistory: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-us' } })
}))

vi.mock('@renderer/components/VirtualList', () => ({
  DynamicVirtualList: ({
    list,
    children
  }: {
    list: TranslateHistoryItem[]
    children: (item: TranslateHistoryItem) => React.ReactNode
  }) => (
    <div>
      {list.map((item) => (
        <div key={item.id}>{children(item)}</div>
      ))}
    </div>
  )
}))

vi.mock('@renderer/hooks/translate', () => ({
  useLanguages: () => ({
    getLanguage: (langCode: string) => languages.find((language) => language.langCode === langCode),
    getLabel: (language: TranslateLanguage | null) => language?.value
  }),
  useTranslateHistories: () => ({
    items: histories,
    total: histories.length,
    hasMore: false,
    isLoadingMore: false,
    loadMore: vi.fn(),
    status: 'success'
  }),
  useTranslateHistory: () => translateHistoryMock.useTranslateHistory()
}))

vi.mock('@renderer/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('@cherrystudio/ui', () => ({
  ConfirmDialog: () => null,
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
  NormalTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PageSidePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

const english: TranslateLanguage = {
  value: 'English',
  langCode: parsePersistedLangCode('en-us'),
  emoji: '🇬🇧',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const chinese: TranslateLanguage = {
  value: 'Chinese',
  langCode: parsePersistedLangCode('zh-cn'),
  emoji: '🇨🇳',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const languages = [english, chinese]

const histories: TranslateHistoryItem[] = [
  {
    id: '1',
    sourceText: 'hello',
    targetText: '你好',
    sourceLanguage: english.langCode,
    targetLanguage: chinese.langCode,
    star: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: '2',
    sourceText: 'bye',
    targetText: '再见',
    sourceLanguage: english.langCode,
    targetLanguage: chinese.langCode,
    star: true,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z'
  }
]

describe('TranslateHistory', () => {
  beforeEach(() => {
    translateHistoryMock.useTranslateHistory.mockReset()
    translateHistoryMock.useTranslateHistory.mockReturnValue({
      clear: vi.fn(),
      update: vi.fn(),
      remove: vi.fn()
    })
  })

  it('does not create one translate history mutation hook per visible row', () => {
    render(<TranslateHistory isOpen onHistoryItemClick={vi.fn()} onClose={vi.fn()} />)

    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByText('bye')).toBeInTheDocument()
    expect(translateHistoryMock.useTranslateHistory).toHaveBeenCalledTimes(1)
  })
})
