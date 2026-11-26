import { mockPreferenceState } from '@test-mocks/renderer/PreferenceService'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ComponentProps, useState } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import type * as Platform from '@renderer/utils/platform'
import { LOCAL_AGENT_PRESETS } from '@shared/ai/localAgent'

import { LocalAgentTerminalDialog } from '../LocalAgentTerminalDialog'

vi.unmock('@cherrystudio/ui')

vi.mock('@renderer/utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof Platform>()),
  isMac: true,
  isWin: false
}))

function Harness({
  presetId = 'claude',
  launch
}: {
  presetId?: string
  launch: ComponentProps<typeof LocalAgentTerminalDialog>['onLaunch']
}) {
  const [open, setOpen] = useState(true)
  const preset = LOCAL_AGENT_PRESETS.find((entry) => entry.id === presetId)!
  return (
    <LocalAgentTerminalDialog
      open={open}
      preset={preset}
      name={preset.name}
      onClose={() => setOpen(false)}
      onLaunch={launch}
    />
  )
}

function mockFolderSelection(folder: string | null) {
  vi.spyOn(ipcApi, 'request').mockImplementation(
    async (route) =>
      (route === 'file.select_folder'
        ? folder
        : [
            { id: 'Terminal', name: 'Terminal' },
            { id: 'iTerm2', name: 'iTerm2' }
          ]) as never
  )
}

beforeEach(() => {
  mockPreferenceState.set('feature.code_cli.configs', {})
  mockPreferenceState.set('feature.code_cli.workspace', {})
  mockFolderSelection('/projects/new folder')
})

it('reuses Code Mate settings and preserves provider/model configuration when choosing a directory', async () => {
  const providerConfig = { modelId: 'custom::model' }
  mockPreferenceState.set('feature.code_cli.configs', {
    'claude-code': {
      providers: { custom: providerConfig },
      current: 'custom',
      directory: '/projects/old',
      terminal: 'iTerm2'
    },
    codex: { providers: {}, current: null, directory: '/unrelated' }
  })
  const user = userEvent.setup()
  const launch = vi.fn().mockResolvedValue(true)
  render(<Harness launch={launch} />)
  expect(await screen.findByRole('combobox', { name: '终端' })).toHaveTextContent('iTerm2')
  expect(screen.getByDisplayValue('/projects/old')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '选择文件夹' }))
  await user.click(screen.getByRole('button', { name: '启动' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(launch).toHaveBeenCalledWith({ directory: '/projects/new folder', terminal: 'iTerm2' })
  expect(mockPreferenceState.get('feature.code_cli.configs')).toEqual({
    'claude-code': {
      providers: { custom: providerConfig },
      current: 'custom',
      directory: '/projects/old',
      terminal: 'iTerm2'
    },
    codex: { providers: {}, current: null, directory: '/unrelated' }
  })
  expect(mockPreferenceState.get('feature.code_cli.workspace')).toEqual({
    directory: '/projects/new folder',
    directoryHistory: ['/projects/new folder', '/projects/old', '/unrelated']
  })
})

it('prefills another Agent with the shared directory while preserving its terminal app', async () => {
  const user = userEvent.setup()
  const launch = vi.fn().mockResolvedValue(true)
  const view = render(<Harness presetId="kilo" launch={launch} />)
  expect(screen.getByRole('button', { name: '启动' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '选择文件夹' }))
  await user.click(screen.getByRole('button', { name: '启动' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(launch).toHaveBeenCalledWith({ directory: '/projects/new folder', terminal: 'Terminal' })
  view.unmount()
  mockPreferenceState.set('feature.code_cli.configs', {
    'claude-code': { providers: {}, current: null, terminal: 'iTerm2' }
  })
  render(<Harness presetId="claude" launch={launch} />)
  expect(screen.getByDisplayValue('/projects/new folder')).toBeVisible()
  expect(await screen.findByRole('combobox', { name: '终端' })).toHaveTextContent('iTerm2')
})

it('does not start a process or save settings when folder selection and launch are cancelled', async () => {
  mockFolderSelection(null)
  const user = userEvent.setup()
  const launch = vi.fn()
  render(<Harness launch={launch} />)
  await user.click(screen.getByRole('button', { name: '选择文件夹' }))
  expect(screen.getByRole('button', { name: '启动' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '取消' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(launch).not.toHaveBeenCalled()
  expect(mockPreferenceState.get('feature.code_cli.configs')).toEqual({})
  expect(mockPreferenceState.get('feature.code_cli.workspace')).toEqual({})
})

it('selects a recent directory and moves it to the front without duplicating it', async () => {
  mockPreferenceState.set('feature.code_cli.configs', {
    kilo: {
      providers: {},
      current: null,
      directory: '/projects/current',
      directoryHistory: ['/projects/current', '/projects/中文 folder', '/projects/older']
    }
  })
  const user = userEvent.setup()
  const launch = vi.fn().mockResolvedValue(true)
  render(<Harness presetId="kilo" launch={launch} />)
  await user.click(screen.getByRole('button', { name: '最近使用的目录' }))
  await user.click(screen.getByRole('button', { name: /^\/projects\/中文 folder$/ }))
  expect(screen.getByDisplayValue('/projects/中文 folder')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '启动' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(launch).toHaveBeenCalledWith({ directory: '/projects/中文 folder', terminal: 'Terminal' })
  expect(mockPreferenceState.get('feature.code_cli.workspace')?.directoryHistory).toEqual([
    '/projects/中文 folder',
    '/projects/current',
    '/projects/older'
  ])
})

it('keeps a removed legacy folder out of other Agents’ recent directories', async () => {
  const unrelated = { providers: {}, current: null, directory: '/projects/old' }
  mockPreferenceState.set('feature.code_cli.configs', {
    kilo: { providers: {}, current: null, directory: '/projects/old' },
    codex: unrelated
  })
  const user = userEvent.setup()
  const launch = vi.fn()
  const view = render(<Harness presetId="kilo" launch={launch} />)
  await user.click(screen.getByRole('button', { name: '最近使用的目录' }))
  await user.click(screen.getByRole('button', { name: '从历史记录中移除 /projects/old' }))
  await waitFor(() => expect(mockPreferenceState.get('feature.code_cli.workspace')?.directoryHistory).toEqual([]))
  expect(screen.getByDisplayValue('/projects/old')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '取消' }))
  view.unmount()
  render(<Harness presetId="codex" launch={launch} />)
  expect(screen.getByDisplayValue('/projects/old')).toBeVisible()
  expect(screen.queryByRole('button', { name: '最近使用的目录' })).not.toBeInTheDocument()
  expect(mockPreferenceState.get('feature.code_cli.configs')).toEqual({
    kilo: { providers: {}, current: null, directory: '/projects/old' },
    codex: unrelated
  })
  expect(launch).not.toHaveBeenCalled()
})
