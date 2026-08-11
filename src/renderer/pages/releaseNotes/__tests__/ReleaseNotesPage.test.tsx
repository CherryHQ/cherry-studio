import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ language: 'zh-CN' }))

vi.stubGlobal('__APP_RELEASE_NOTES__', '<!--LANG:en-->English feature<!--LANG:zh-CN-->中文功能<!--LANG:END-->')
vi.stubGlobal('__APP_RELEASE_VERSION__', '2.0.2')

vi.mock('@renderer/components/ReleaseNotes', () => ({
  ReleaseNotes: ({ content }: { content: string }) => <div>{content}</div>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'settings.about.releases.title' ? 'Release Notes' : key),
    i18n: { language: mocks.language, resolvedLanguage: mocks.language }
  })
}))

import ReleaseNotesPage from '../ReleaseNotesPage'

describe('ReleaseNotesPage', () => {
  beforeEach(() => {
    mocks.language = 'zh-CN'
  })

  it.each([
    ['zh-CN', '中文功能', 'English feature'],
    ['en-US', 'English feature', '中文功能']
  ])('shows the bundled release notes for %s', (language, expected, hidden) => {
    mocks.language = language

    render(<ReleaseNotesPage />)

    expect(screen.getByRole('heading', { name: 'Release Notes' })).toBeInTheDocument()
    expect(screen.getByText('v2.0.2')).toBeInTheDocument()
    expect(screen.getByText(expected)).toBeInTheDocument()
    expect(screen.queryByText(hidden)).not.toBeInTheDocument()
  })
})
