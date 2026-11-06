import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { useState } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { Scrollbar } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'

import { RegistrySkillsCatalog, type SkillRegistrySource } from '../RegistrySkillsCatalog'
import { SkillSubscriptionBar } from '../SkillSubscriptionBar'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))

const pdf = {
  id: 'pdf',
  name: 'PDF tools',
  namespace: '@anthropics/skills/pdf',
  description: 'Work with PDF documents',
  sourceUrl: 'https://github.com/anthropics/skills/tree/main/skills/pdf',
  metadata: { repoOwner: 'anthropics', repoName: 'skills', directoryPath: 'skills/pdf' }
}

function Catalog() {
  const [source, setSource] = useState<SkillRegistrySource>('skills.sh')
  const [query, setQuery] = useState('')
  return (
    <>
      <SkillSubscriptionBar
        sourceId={source}
        onSelect={(id) => setSource(id as SkillRegistrySource)}
        active
        refreshing={false}
        onRefresh={() => {}}
      />
      <input aria-label="Search skills" value={query} onChange={(event) => setQuery(event.target.value)} />
      <Scrollbar aria-label="Skill catalog" tabIndex={0}>
        <RegistrySkillsCatalog key={source} source={source} query={query} active />
      </Scrollbar>
    </>
  )
}

beforeEach(async () => {
  await i18next.changeLanguage('en-us')
  MockUsePreferenceUtils.setPreferenceValue('ui.marketplace.skill_sources', [])
  Element.prototype.scrollTo = vi.fn()
  vi.mocked(ipcApi.request).mockReset()
  vi.mocked(ipcApi.request).mockResolvedValue({ success: true, data: { id: 'installed-pdf' } })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('switches registries, browses subsequent raw offsets, searches and installs the chosen directory from details', async () => {
  const user = userEvent.setup()
  const urls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      urls.push(input)
      const url = new URL(input)
      const body =
        url.hostname === 'skills.sh'
          ? {
              skills: [{ skillId: 'react', name: 'React patterns', source: 'owner/repo', installs: 12 }],
              page: 0,
              hasMore: false
            }
          : url.searchParams.has('q')
            ? { skills: [pdf] }
            : url.searchParams.get('offset') === '0'
              ? { skills: [{ ...pdf, metadata: null }], offset: 0, limit: 20, total: 2 }
              : { skills: [pdf], offset: 1, limit: 20, total: 2 }
      return { ok: true, json: async () => body }
    })
  )
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <Catalog />
    </SWRConfig>
  )
  expect(await screen.findByText('React patterns')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'claude-plugins.dev' }))
  expect(await screen.findByText('PDF tools')).toBeVisible()
  expect(screen.queryByText('React patterns')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /remove subscription/i })).not.toBeInTheDocument()
  expect(urls).toContain('https://claude-plugins.dev/api/skills?limit=20&offset=1')
  await user.type(screen.getByRole('textbox', { name: 'Search skills' }), 'pdf')
  await waitFor(() => expect(urls).toContain('https://claude-plugins.dev/api/skills?q=pdf&limit=20'))
  await user.click(await screen.findByRole('button', { name: /PDF tools Work with PDF/ }))
  await user.click(screen.getByRole('button', { name: 'Install now' }))
  await waitFor(() =>
    expect(ipcApi.request).toHaveBeenCalledWith('skill.install', {
      installSource: 'claude-plugins:anthropics/skills/skills/pdf'
    })
  )
})

it('recovers from a failed catalog request through retry and shows an empty catalog', async () => {
  const user = userEvent.setup()
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({
        ok: true,
        json: async () => ({ skills: [], offset: 0, limit: 20, total: 0 })
      })
  )
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <RegistrySkillsCatalog source="claude-plugins.dev" query="" active />
    </SWRConfig>
  )
  expect(await screen.findByRole('alert')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('No resources found')).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('reveals more skills at the scroll sentinel and returns keyboard focus after closing details', async () => {
  const user = userEvent.setup()
  let intersect: IntersectionObserverCallback | undefined
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback
      }
      observe() {}
      disconnect() {}
    }
  )
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        skills: Array.from({ length: 31 }, (_, index) => ({
          skillId: 'skill-' + index,
          name: 'Skill ' + index,
          source: 'owner/repo',
          installs: 1
        })),
        page: 0,
        hasMore: false
      })
    })
  )
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <Catalog />
    </SWRConfig>
  )
  expect(await screen.findByText('Skill 0')).toBeVisible()
  expect(screen.queryByText('Skill 30')).not.toBeInTheDocument()
  await act(async () => {
    intersect?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
  })
  expect(await screen.findByText('Skill 30')).toBeVisible()
  const opener = screen.getByRole('button', { name: /^Skill 30 / })
  await user.click(opener)
  expect(screen.getByRole('dialog')).toBeVisible()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(opener).toHaveFocus())
})
