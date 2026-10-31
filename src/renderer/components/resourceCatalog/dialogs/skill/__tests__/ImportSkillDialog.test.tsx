import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

const previewImport = vi.fn()
const applyImport = vi.fn()
const ipcApiRequest = vi.hoisted(() => vi.fn())

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcApiRequest } }))

const fileMetadata = {
  kind: 'file' as const,
  type: 'other' as const,
  size: 0,
  createdAt: 0,
  modifiedAt: 0,
  mime: 'application/octet-stream'
}
const directoryMetadata = { kind: 'directory' as const, size: 0, createdAt: 0, modifiedAt: 0 }

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return actual
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string | number>) => {
      if (!opts) return key
      if ('written' in opts) return `${key}:${opts.written}:${opts.skipped}:${opts.failed}`
      if ('name' in opts) return `${key}:${opts.name}`
      if ('count' in opts) return `${key}:${opts.count}`
      if ('success' in opts && 'total' in opts && 'failed' in opts) {
        return `${key}:${opts.success}:${opts.total}:${opts.failed}`
      }
      return key
    }
  })
}))

vi.mock('@renderer/hooks/useSkills', () => ({
  useSkillInstall: () => ({ previewImport, applyImport })
}))

import { toast } from '@renderer/services/toast'
import type { SkillImportInput, SkillImportPreviewItem } from '@shared/types/skill'

import { ImportSkillDialog } from '../ImportSkillDialog'

const createDropData = (files: File[]) => ({
  dataTransfer: {
    files,
    items: files.map((file) => ({
      kind: 'file',
      type: file.type,
      getAsFile: () => file
    })),
    types: ['Files']
  }
})

const dropSkillFiles = async (files: File[]) => {
  const dropzone = screen.getByText('library.import_skill_dialog.local.drop_hint').closest('button')
  expect(dropzone).toBeInTheDocument()

  await act(async () => {
    fireEvent.drop(dropzone!, createDropData(files))
  })
}

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {}
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {}
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  previewImport.mockReset()
  applyImport.mockReset()
  previewImport.mockImplementation(async (items: SkillImportInput[]) => ({
    revision: 'revision-1',
    items: items.map((item) => plan(item.id))
  }))
  applyImport.mockImplementation(async (items: SkillImportInput[]) =>
    items.map((item) => ({
      id: item.id,
      status: 'installed',
      skillId: `skill-${item.id}`,
      folderName: 'skill'
    }))
  )
  ipcApiRequest.mockReset()
  ipcApiRequest.mockResolvedValue(fileMetadata)
  Object.assign(window, {
    api: {
      ...window.api,
      file: {
        ...window.api?.file,
        getPathForFile: vi.fn((file: File) => `/tmp/${file.name}`),
        select: vi.fn(async () => [{ name: 'broken.zip', path: '/tmp/broken.zip' }])
      }
    }
  })
})

afterEach(cleanup)

function plan(id: string, overrides: Partial<SkillImportPreviewItem> = {}): SkillImportPreviewItem {
  return {
    id,
    status: 'new',
    reasons: [],
    target: null,
    otherMatches: [],
    destinationFolder: 'skill',
    provenanceChange: null,
    ...overrides
  }
}
const pickZip = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'settings.skills.installFromZip' }))
  await waitFor(() => expect(screen.getByRole('button', { name: /library.import_skill_dialog.apply:/ })).toBeEnabled())
}
const applyBatch = async () => {
  await userEvent.click(screen.getByRole('button', { name: /library.import_skill_dialog.apply:/ }))
}
const selected = [
  { name: 'one.zip', path: '/tmp/one.zip' },
  { name: 'two.zip', path: '/tmp/two.zip' }
]

// Catch implicit writes before approval, policy/revision mismatches, lost outcomes, and dismissals during writes.
describe('ImportSkillDialog', () => {
  it('closes when clicking the overlay while idle', () => {
    const onOpenChange = vi.fn()
    render(<ImportSkillDialog open onOpenChange={onOpenChange} />)
    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay).toBeInTheDocument()
    fireEvent.click(overlay!)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('reviews every selected input in order without applying and defaults to skip', async () => {
    vi.mocked(window.api.file.select).mockResolvedValue(selected as any)
    render(<ImportSkillDialog open onOpenChange={vi.fn()} />)
    await pickZip()
    const results = screen.getByTestId('skill-import-results')
    expect([...results.querySelectorAll('.truncate')].map((row) => row.textContent)).toEqual(['one.zip', 'two.zip'])
    expect(screen.getByRole('radio', { name: 'library.import_skill_dialog.skip' })).toBeChecked()
    expect(previewImport.mock.calls[0]).toEqual([
      [
        { id: expect.any(String), kind: 'zip', path: '/tmp/one.zip' },
        { id: expect.any(String), kind: 'zip', path: '/tmp/two.zip' }
      ],
      'skip'
    ])
    expect(applyImport).not.toHaveBeenCalled()
    await applyBatch()
    expect(applyImport.mock.calls[0]).toEqual([previewImport.mock.calls[0][0], 'skip', 'revision-1'])
    expect(await screen.findAllByText('library.system_skill.imported')).toHaveLength(2)
    expect(window.api.file.select).toHaveBeenCalledWith(
      expect.objectContaining({ properties: ['openFile', 'multiSelections'] })
    )
  })

  it('re-previews update and disables Apply until the new revision arrives', async () => {
    render(<ImportSkillDialog open onOpenChange={vi.fn()} />)
    await pickZip()
    const inputs = previewImport.mock.calls[0][0]
    let resolveScan!: (value: unknown) => void
    previewImport.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveScan = resolve
      })
    )
    await userEvent.click(screen.getByRole('radio', { name: 'library.import_skill_dialog.update' }))
    expect(previewImport.mock.calls[1]).toEqual([inputs, 'update'])
    expect(screen.getByRole('button', { name: /library.import_skill_dialog.apply:/ })).toBeDisabled()
    expect(screen.getByText('library.import_skill_dialog.scanning')).toBeVisible()
    expect(applyImport).not.toHaveBeenCalled()
    await act(async () =>
      resolveScan({ revision: 'revision-2', items: inputs.map((item: SkillImportInput) => plan(item.id)) })
    )
    await applyBatch()
    expect(applyImport.mock.calls[0]).toEqual([inputs, 'update', 'revision-2'])
    expect(await screen.findByText('library.system_skill.imported')).toBeVisible()
  })

  it('keeps the dialog open and renders all outcomes until Close', async () => {
    const onOpenChange = vi.fn()
    const statuses = ['installed', 'updated', 'skipped', 'blocked', 'error']
    vi.mocked(window.api.file.select).mockResolvedValue(
      statuses.map((status) => ({ name: `${status}.zip`, path: `/tmp/${status}.zip` })) as any
    )
    applyImport.mockImplementationOnce(async (items: SkillImportInput[]) =>
      items.map((item, index) => ({
        id: item.id,
        status: statuses[index],
        message: index >= 3 ? 'localized failure' : undefined
      }))
    )
    render(<ImportSkillDialog open onOpenChange={onOpenChange} />)
    await pickZip()
    await applyBatch()
    for (const label of [
      'library.system_skill.imported',
      'library.import_skill_dialog.updated',
      'library.import_skill_dialog.skipped',
      'library.import_skill_dialog.blocked',
      'agent.tasks.logs.failed'
    ]) {
      expect(await screen.findByText(label)).toBeVisible()
    }
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(vi.mocked(toast.success).mock.calls).toEqual([['library.import_skill_dialog.summary:2:1:2']])
    await userEvent.click(screen.getByRole('button', { name: 'common.close' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('cancels after preview with zero applies', async () => {
    const onOpenChange = vi.fn()
    render(<ImportSkillDialog open onOpenChange={onOpenChange} />)
    await pickZip()
    expect(screen.getByTestId('skill-import-results')).toHaveTextContent('broken.zip')
    await userEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(applyImport).not.toHaveBeenCalled()
  })

  it.each([
    ['zip', 'broken.zip', '未找到可安装的技能。技能 ZIP 压缩包必须在根目录或某个子目录里包含 SKILL.md。'],
    ['directory', 'broken-skill', '未在所选文件夹中找到 SKILL.md。请选择直接包含 SKILL.md 的文件夹。']
  ])('renders the complete localized %s error without leaking a path', async (kind, name, originalError) => {
    const onOpenChange = vi.fn()
    vi.mocked(window.api.file.select).mockResolvedValue([{ name, path: `/tmp/${name}` }] as any)
    previewImport.mockImplementationOnce(async (items: SkillImportInput[]) => ({
      revision: 'revision-1',
      items: [plan(items[0].id, { status: 'invalid', message: originalError })]
    }))
    render(<ImportSkillDialog open onOpenChange={onOpenChange} />)
    await userEvent.click(
      screen.getByRole('button', {
        name: kind === 'zip' ? 'settings.skills.installFromZip' : 'settings.skills.installFromDirectory'
      })
    )
    const fullMessage = `settings.skills.installFailed:${name}: ${originalError}`
    expect(await screen.findByText(fullMessage)).toBeInTheDocument()
    expect(screen.getByTitle(fullMessage)).toHaveAttribute('title', fullMessage)
    expect(screen.getByTestId('skill-import-results')).not.toHaveTextContent(
      /skill-install|zip[-_]install[-_]|[\\/]tmp[\\/]|[\\/]Temp[\\/]/
    )
    expect(screen.queryByText('settings.skills.batchInstallPartialFailed:0:1:1')).not.toBeInTheDocument()
    expect(toast.error).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('truncates long names and wraps complete errors', async () => {
    const longName = `Xiao_Yue_Complete_Internal_Documentation_${'1'.repeat(120)}.zip`
    vi.mocked(window.api.file.select).mockResolvedValue([{ name: longName, path: `/tmp/${longName}` }] as any)
    previewImport.mockImplementationOnce(async (items: SkillImportInput[]) => ({
      revision: 'revision-1',
      items: [plan(items[0].id, { status: 'invalid', message: 'corrupt archive' })]
    }))
    render(<ImportSkillDialog open onOpenChange={vi.fn()} />)
    await pickZip()
    expect(screen.getByTitle(longName)).toHaveTextContent(longName)
    expect(screen.getByTitle(longName)).toHaveClass('truncate')
    const message = `settings.skills.installFailed:${longName}: corrupt archive`
    expect(screen.getByTitle(message)).toHaveTextContent(message)
    expect(screen.getByText(message)).toHaveClass('whitespace-normal', 'break-words', '[overflow-wrap:anywhere]')
  })

  it('previews every selected directory through the batch route', async () => {
    vi.mocked(window.api.file.select).mockResolvedValue([
      { name: 'skill-one', path: '/tmp/skill-one' },
      { name: 'skill-two', path: '/tmp/skill-two' }
    ] as any)
    render(<ImportSkillDialog open onOpenChange={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'settings.skills.installFromDirectory' }))
    expect(await screen.findByTitle('skill-two')).toBeVisible()
    expect(window.api.file.select).toHaveBeenCalledWith(
      expect.objectContaining({ properties: ['openDirectory', 'multiSelections'] })
    )
    expect(previewImport.mock.calls[0][0]).toEqual([
      { id: expect.any(String), kind: 'directory', path: '/tmp/skill-one' },
      { id: expect.any(String), kind: 'directory', path: '/tmp/skill-two' }
    ])
    expect(applyImport).not.toHaveBeenCalled()
    await applyBatch()
    expect(await screen.findAllByText('library.system_skill.imported')).toHaveLength(2)
  })

  it('previews all dropped ZIP files before importing them', async () => {
    const files = [
      new File(['one'], 'one.zip', { type: 'application/zip' }),
      new File(['two'], 'two.zip', { type: 'application/zip' })
    ]
    render(<ImportSkillDialog open onOpenChange={vi.fn()} />)
    await dropSkillFiles(files)
    expect(await screen.findByTitle('two.zip')).toBeVisible()
    expect(window.api.file.getPathForFile).toHaveBeenNthCalledWith(1, files[0])
    expect(window.api.file.getPathForFile).toHaveBeenNthCalledWith(2, files[1])
    expect(ipcApiRequest).toHaveBeenNthCalledWith(1, 'file.get_metadata', { kind: 'path', path: '/tmp/one.zip' })
    expect(ipcApiRequest).toHaveBeenNthCalledWith(2, 'file.get_metadata', { kind: 'path', path: '/tmp/two.zip' })
    expect(previewImport.mock.calls[0][0]).toEqual([
      { id: expect.any(String), kind: 'zip', path: '/tmp/one.zip' },
      { id: expect.any(String), kind: 'zip', path: '/tmp/two.zip' }
    ])
    expect(applyImport).not.toHaveBeenCalled()
    await applyBatch()
    expect(await screen.findAllByText('library.system_skill.imported')).toHaveLength(2)
  })

  it('keeps invalid dropped rows and applies the other ZIPs and directories', async () => {
    const onOpenChange = vi.fn()
    const files = [
      new File(['skill'], 'skill-dir'),
      new File(['zip'], 'plugin.zip'),
      new File(['readme'], 'readme.txt')
    ]
    ipcApiRequest.mockImplementation(async (_route: string, handle: { path: string }) =>
      handle.path === '/tmp/skill-dir' ? directoryMetadata : fileMetadata
    )
    previewImport.mockImplementationOnce(async (items: SkillImportInput[]) => ({
      revision: 'revision-1',
      items: items.map((item, index) =>
        plan(item.id, index === 2 ? { status: 'invalid', message: 'settings.skills.invalidFormat' } : {})
      )
    }))
    applyImport.mockImplementationOnce(async (items: SkillImportInput[]) =>
      items.map((item, index) => ({
        id: item.id,
        status: index === 2 ? 'error' : 'installed',
        message: index === 2 ? 'settings.skills.invalidFormat' : undefined
      }))
    )
    render(<ImportSkillDialog open onOpenChange={onOpenChange} />)
    await dropSkillFiles(files)
    expect(await screen.findByText('library.import_skill_dialog.status_invalid')).toBeVisible()
    expect(screen.getByTestId('skill-import-results')).toHaveTextContent('readme.txt')
    expect(screen.getByTestId('skill-import-results')).toHaveTextContent('settings.skills.invalidFormat')
    expect(screen.getByRole('button', { name: 'library.import_skill_dialog.apply:2' })).toBeEnabled()
    expect(applyImport).not.toHaveBeenCalled()
    await applyBatch()
    expect(applyImport.mock.calls[0][0]).toEqual(previewImport.mock.calls[0][0])
    expect(await screen.findAllByText('library.system_skill.imported')).toHaveLength(2)
    expect(screen.getByTestId('skill-import-results')).toHaveTextContent('readme.txt')
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('shows invalid-only drops once per input without a duplicate banner', async () => {
    previewImport.mockImplementationOnce(async (items: SkillImportInput[]) => ({
      revision: 'revision-1',
      items: items.map((item) => plan(item.id, { status: 'invalid', message: 'settings.skills.invalidFormat' }))
    }))
    render(<ImportSkillDialog open onOpenChange={vi.fn()} />)
    await dropSkillFiles(['one', 'two', 'three'].map((name) => new File(['x'], `${name}.txt`)))
    expect(await screen.findByTitle('one.txt')).toBeVisible()
    expect(screen.getByTestId('skill-import-results')).toHaveTextContent('two.txt')
    expect(screen.getByTestId('skill-import-results')).toHaveTextContent('three.txt')
    expect(screen.getAllByText(/settings.skills.installFailed:.*settings.skills.invalidFormat/)).toHaveLength(3)
    expect(screen.queryByText('settings.skills.batchInstallPartialFailed:0:3:3')).not.toBeInTheDocument()
    expect(applyImport).not.toHaveBeenCalled()
  })

  it.each(['scan', 'apply'])('prevents overlay dismissal during %s', async (phase) => {
    let resolve!: (value: unknown) => void
    const onOpenChange = vi.fn()
    if (phase === 'scan')
      previewImport.mockReturnValueOnce(
        new Promise((done) => {
          resolve = done
        })
      )
    else
      applyImport.mockReturnValueOnce(
        new Promise((done) => {
          resolve = done
        })
      )
    render(<ImportSkillDialog open onOpenChange={onOpenChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'settings.skills.installFromZip' }))
    if (phase === 'apply') await applyBatch()
    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay).toBeInTheDocument()
    fireEvent.click(overlay!)
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeVisible()
    await act(async () => resolve(phase === 'scan' ? { revision: 'revision-1', items: [] } : []))
    expect(screen.getByRole('button', { name: phase === 'scan' ? 'common.cancel' : 'common.close' })).toBeEnabled()
  })

  it('shows blocked updates separately from skips and displays the planned target, destination and detach disclosure', async () => {
    vi.mocked(window.api.file.select).mockResolvedValue(selected as any)
    previewImport.mockImplementation(async (items: SkillImportInput[], policy: string) => ({
      revision: `revision-${policy}`,
      items: [
        plan(items[0].id, {
          status: 'conflict',
          reasons: ['folder_name', 'identical_content'],
          target: { kind: 'installed', id: 'market', folderName: 'market-skill', source: 'marketplace' },
          destinationFolder: 'market-skill',
          provenanceChange: policy === 'update' ? { from: 'marketplace', to: 'zip' } : null
        }),
        plan(items[1].id, {
          status: policy === 'update' ? 'blocked' : 'conflict',
          message: policy === 'update' ? 'Builtin cannot be replaced' : undefined
        })
      ]
    }))
    render(<ImportSkillDialog open onOpenChange={vi.fn()} />)
    await pickZip()
    await userEvent.click(screen.getByRole('radio', { name: 'library.import_skill_dialog.update' }))
    expect(await screen.findByText('library.import_skill_dialog.status_blocked')).toBeVisible()
    expect(screen.getByText('library.import_skill_dialog.folder_name')).toBeVisible()
    expect(screen.getByText('library.import_skill_dialog.identical_content')).toBeVisible()
    expect(screen.getByText('library.import_skill_dialog.target:market-skill')).toBeVisible()
    expect(screen.getByText('library.import_skill_dialog.destination:market-skill')).toBeVisible()
    expect(screen.getByText('library.import_skill_dialog.detach')).toBeVisible()
    expect(screen.getByText(/Builtin cannot be replaced/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'library.import_skill_dialog.apply:1' })).toBeEnabled()
    expect(screen.queryByText('library.import_skill_dialog.skipped')).not.toBeInTheDocument()
    expect(applyImport).not.toHaveBeenCalled()
  })

  it.each(['preview', 'apply'])('renders a thrown %s error for the caller', async (phase) => {
    if (phase === 'preview') previewImport.mockRejectedValueOnce(new Error('Native preview error'))
    else applyImport.mockRejectedValueOnce(new Error('Native apply error'))
    const onOpenChange = vi.fn()
    render(<ImportSkillDialog open onOpenChange={onOpenChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'settings.skills.installFromZip' }))
    if (phase === 'apply') await applyBatch()
    expect(await screen.findByText(new RegExp(`Native ${phase} error`))).toBeVisible()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /library.import_skill_dialog.apply:/ })).toHaveProperty(
      'disabled',
      phase === 'preview'
    )
  })

  it('returns stale outcomes to Review with one fresh-preview action', async () => {
    applyImport.mockImplementationOnce(async (items: SkillImportInput[]) =>
      items.map((item) => ({
        id: item.id,
        status: 'error',
        code: 'stale_plan',
        retryable: true,
        message: 'Preview changed'
      }))
    )
    render(<ImportSkillDialog open onOpenChange={vi.fn()} />)
    await pickZip()
    await applyBatch()
    expect(await screen.findByText(/Preview changed/)).toBeVisible()
    expect(screen.getAllByRole('button', { name: 'library.import_skill_dialog.retry' })).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'library.import_skill_dialog.retry' }))
    expect(screen.getByRole('radio', { name: 'library.import_skill_dialog.skip' })).toBeChecked()
    expect(screen.getByRole('button', { name: /library.import_skill_dialog.apply:/ })).toBeEnabled()
    expect(previewImport.mock.calls).toHaveLength(2)
    expect(applyImport.mock.calls).toHaveLength(1)
  })
})
