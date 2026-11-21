import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
  frontmatter: { name: 'reports', description: 'Build a report' },
  resources: []
}
let savedServer = server
const update = vi.fn<ReturnType<typeof useMcpServer>['updateMcpServer']>()
const panel = (value = server) => (
  <I18nextProvider i18n={i18n}>
    <McpSkillsSection server={value} updateMcpServer={update} />
  </I18nextProvider>
)

const browserMethods = ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture', 'scrollIntoView'] as const
const originalMethods = browserMethods.map((name) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, name))
beforeAll(() => {
  for (const name of browserMethods)
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      value: name === 'hasPointerCapture' ? () => false : () => {}
    })
})
afterAll(() => {
  browserMethods.forEach((name, index) => {
    const original = originalMethods[index]
    if (original) Object.defineProperty(HTMLElement.prototype, name, original)
    else Reflect.deleteProperty(HTMLElement.prototype, name)
  })
})

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
  it('saves the selected permission for its URI and retains another Skill’s permission', async () => {
    const user = userEvent.setup()
    const view = render(panel())
    const selector = await screen.findByRole('combobox', { name: 'Reading permission for reports' })
    await user.click(selector)
    await user.click(screen.getByRole('option', { name: en['settings.mcp.skills.auto'] }))
    await waitFor(() =>
      expect(savedServer.skillPermissions).toEqual({
        'skill://other/SKILL.md': 'disabled',
        [skill.uri]: 'auto'
      })
    )
    view.unmount()
    render(panel(savedServer))
    expect(await screen.findByRole('combobox', { name: 'Reading permission for reports' })).toHaveTextContent(
      en['settings.mcp.skills.auto']
    )
  })

  it('retains a disabled entry so it can be enabled again', async () => {
    const user = userEvent.setup()
    render(panel({ ...server, skillPermissions: { [skill.uri]: 'disabled' } }))
    const selector = await screen.findByRole('combobox', { name: 'Reading permission for reports' })
    expect(selector).toHaveTextContent(en['settings.mcp.skills.disabled'])
    await user.click(selector)
    await user.click(screen.getByRole('option', { name: en['settings.mcp.skills.prompt'] }))
    await waitFor(() => expect(savedServer.skillPermissions).toEqual({ [skill.uri]: 'prompt' }))
  })
})
