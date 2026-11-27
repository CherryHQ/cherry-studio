import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import type { MarketplaceSkill } from '@shared/types/skillMarketplace'

import { MarketplaceSkillDialog } from '../MarketplaceSkillDialog'
import { MarketplaceSkills } from '../MarketplaceSkills'
import type { useMarketplace } from '../useMarketplace'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))

const skill: MarketplaceSkill = {
  id: 'writing',
  name: { en: 'Writing', zh: null },
  description: { en: 'Short summary', zh: null },
  domain: 'Other',
  author: '',
  version: '',
  tags: [],
  githubRepoUrl: null,
  sourceUrl: null,
  icon: null,
  packageName: null,
  packageSize: null,
  hasPackage: true,
  downloadUrl: null,
  downloads: 0,
  releaseDate: '',
  members: [],
  membersKnown: false,
  isCollection: false
}

beforeEach(async () => {
  await i18next.changeLanguage('en-us')
  vi.mocked(ipcApi.request).mockReset()
})
afterEach(cleanup)

it.each([
  { en: 'Detailed usage instructions', zh: null },
  { en: '', zh: '详细使用说明' }
])('shows a curated skill long description using the available language', async (longDescription) => {
  vi.mocked(ipcApi.request).mockResolvedValue({ ...skill, longDescription })
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <MarketplaceSkillDialog
        skill={skill}
        open
        onOpenChange={() => {}}
        onReturnFocus={() => {}}
        installedCount={0}
        installing={false}
        installedLoading={false}
        failures={[]}
        onInstall={() => {}}
      />
    </SWRConfig>
  )

  expect(await screen.findByText(longDescription.en || longDescription.zh!)).toBeVisible()
})

it('can uninstall local members while the refreshed remote ZIP manifest is unknown', async () => {
  const user = userEvent.setup()
  const subscribed: MarketplaceSkill = {
    ...skill,
    subscription: { sourceId: 'feed', url: 'https://example.com/writing.zip', kind: 'zip' }
  }
  const mutateSkill = vi.fn().mockResolvedValue(true)
  const market = {
    catalog: { data: [subscribed], isLoading: false },
    installed: { loading: false, error: null },
    installedCount: () => 1,
    installedMembers: () => [{ path: '', name: 'Writing', skillId: 'installed-writing' }],
    mutating: new Set<string>(),
    failures: {},
    skipped: 0,
    mutateSkill
  } as unknown as ReturnType<typeof useMarketplace>
  render(<MarketplaceSkills market={market} query="" active />)

  expect(screen.getByRole('button', { name: 'Install: Writing' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Uninstall: Writing' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Uninstall' }))

  await waitFor(() => expect(mutateSkill).toHaveBeenCalledWith(subscribed, 'uninstall'))
})
