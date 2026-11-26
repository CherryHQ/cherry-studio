import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { useMcpServer } from '@renderer/hooks/useMcpServer'
import en from '@renderer/i18n/locales/en-us.json'
import { type McpServer, McpServerSchema } from '@shared/data/types/mcpServer'
import type { McpSkillEntry } from '@shared/types/mcpSkills'

vi.unmock('@cherrystudio/ui')
vi.unmock('react-i18next')

import McpSkillsSection from '../McpSkill'

const i18n = createInstance()
await i18n.init({
  lng: 'en-US',
  keySeparator: false,
  resources: { 'en-US': { translation: en } },
  interpolation: { escapeValue: false }
})
const server: McpServer = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Origin',
  isActive: true,
  skillPermissions: { 'skill://other/SKILL.md': 'disabled' }
}
const skill: McpSkillEntry = {
  serverId: server.id,
  serverName: server.name,
  uri: 'skill://reports/SKILL.md',
  frontmatter: { name: 'reports', description: 'Build a report', id: 'manifest-label' },
  resources: []
}
let savedServer = server
const update = vi.fn<ReturnType<typeof useMcpServer>['updateMcpServer']>()
const panel = (value = server) => (
  <I18nextProvider i18n={i18n}>
    <McpSkillsSection server={value} updateMcpServer={update} />
  </I18nextProvider>
)

beforeEach(() => {
  savedServer = server
  update.mockReset().mockImplementation(async ({ body } = {}) => {
    savedServer = McpServerSchema.parse({ ...savedServer, ...body })
    return savedServer
  })
  vi.spyOn(window.api.ipcApi, 'request').mockImplementation(async (route, input) => {
    if (route === 'mcp.request.cancel') return { ok: true, data: undefined }
    if (route !== 'mcp.server.list_skills') throw new Error(`Unexpected route ${route}`)
    if (!(input && typeof input === 'object' && 'includeDisabled' in input && input.includeDisabled))
      throw new Error('Settings must include disabled entries')
    return { ok: true, data: [skill] }
  })
})

describe('MCP Skill permissions', () => {
  it('saves auto approval for its URI, retains other permissions, and restores approval on remount', async () => {
    const user = userEvent.setup()
    const view = render(panel())
    const autoApprove = await screen.findByRole('switch', { name: 'Auto Approve: reports' })
    expect(autoApprove).not.toBeChecked()
    await user.click(autoApprove)
    await waitFor(() =>
      expect(savedServer.skillPermissions).toEqual({
        'skill://other/SKILL.md': 'disabled',
        [skill.uri]: 'auto'
      })
    )
    view.unmount()
    const restored = render(panel(savedServer))
    const restoredAutoApprove = await screen.findByRole('switch', { name: 'Auto Approve: reports' })
    expect(restoredAutoApprove).toBeChecked()
    await user.click(restoredAutoApprove)
    await waitFor(() => expect(savedServer.skillPermissions?.[skill.uri]).toBe('prompt'))
    restored.rerender(panel(savedServer))
    expect(screen.getByRole('switch', { name: 'Enabled: reports' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Auto Approve: reports' })).not.toBeChecked()
  })

  it('disables a Skill and enables it again with approval required', async () => {
    const user = userEvent.setup()
    const view = render(panel())
    await user.click(await screen.findByRole('switch', { name: 'Enabled: reports' }))
    await waitFor(() => expect(savedServer.skillPermissions?.[skill.uri]).toBe('disabled'))
    view.rerender(panel(savedServer))
    expect(screen.getByRole('switch', { name: 'Enabled: reports' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Auto Approve: reports' })).toBeDisabled()
    await user.click(screen.getByRole('switch', { name: 'Enabled: reports' }))
    await waitFor(() => expect(savedServer.skillPermissions?.[skill.uri]).toBe('prompt'))
    view.rerender(panel(savedServer))
    expect(screen.getByRole('switch', { name: 'Enabled: reports' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Auto Approve: reports' })).not.toBeChecked()
    expect(savedServer.skillPermissions?.['skill://other/SKILL.md']).toBe('disabled')
  })
})
