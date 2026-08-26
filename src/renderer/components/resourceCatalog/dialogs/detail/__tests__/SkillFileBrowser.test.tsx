import type * as CherryStudioUi from '@cherrystudio/ui'
import type { SkillFileNode } from '@shared/types/skill'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { cancelMock, listFilesMock, readSkillFileMock, toastErrorMock, translateMock } = vi.hoisted(() => ({
  cancelMock: vi.fn(),
  listFilesMock: vi.fn(),
  readSkillFileMock: vi.fn(),
  toastErrorMock: vi.fn(),
  translateMock: vi.fn()
}))

function translateKey(key: string) {
  return key
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translateKey })
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return {
    ...actual,
    Markdown: ({ children }: { children: string }) => <article>markdown: {children}</article>
  }
})

vi.mock('@renderer/hooks/translate', () => ({
  useTranslate: () => ({
    translate: translateMock,
    isTranslating: false,
    cancel: cancelMock
  })
}))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: { withContext: () => ({ warn: vi.fn() }) }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: toastErrorMock }
}))

vi.mock('@iconify/react', () => ({
  Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />
}))

vi.mock('@renderer/components/VirtualList', () => ({
  DynamicVirtualList: ({
    list,
    children
  }: {
    list: unknown[]
    children: (item: unknown, index: number) => ReactNode
  }) => (
    <div>
      {list.map((item, index) => (
        <div key={index}>{children(item, index)}</div>
      ))}
    </div>
  )
}))

vi.mock('@renderer/components/CodeViewer', () => ({
  default: ({ value, expanded, height }: { value: string; expanded: boolean; height: string }) => (
    <pre data-expanded={String(expanded)} data-height={height}>
      code viewer: {value}
    </pre>
  )
}))

import { SkillFileBrowser } from '../SkillFileBrowser'

const tree: SkillFileNode[] = [
  { name: 'SKILL.md', path: 'SKILL.md', type: 'file' },
  {
    name: 'scripts',
    path: 'scripts',
    type: 'directory',
    children: [
      { name: 'SKILL.md', path: 'scripts/SKILL.md', type: 'file' },
      { name: 'setup.ts', path: 'scripts/setup.ts', type: 'file' }
    ]
  }
]

describe('SkillFileBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listFilesMock.mockResolvedValue({ success: true, data: tree })
    readSkillFileMock.mockImplementation(async (_skillId: string, path: string) => ({
      success: true,
      data: path === 'SKILL.md' ? '# Review Helper' : 'export const setup = true'
    }))
    translateMock.mockResolvedValue('# 审查助手')

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        skill: {
          listFiles: listFilesMock,
          readSkillFile: readSkillFileMock
        }
      }
    })
  })

  it('loads the installed file tree and previews SKILL.md by default', async () => {
    render(<SkillFileBrowser skillId="skill-1" />)

    expect(await screen.findByText('markdown: # Review Helper')).toBeInTheDocument()
    expect(screen.getByRole('tree', { name: 'library.skill_detail.source_files' })).toBeInTheDocument()
    expect(screen.getByRole('treeitem', { name: 'SKILL.md' })).toBeInTheDocument()
    expect(screen.queryByRole('treeitem', { name: 'setup.ts' })).not.toBeInTheDocument()
    expect(listFilesMock).toHaveBeenCalledWith('skill-1')
    expect(readSkillFileMock).toHaveBeenCalledWith('skill-1', 'SKILL.md')
  })

  it('previews a selected source file without offering Markdown translation', async () => {
    const user = userEvent.setup()
    render(<SkillFileBrowser skillId="skill-1" />)

    await screen.findByText('markdown: # Review Helper')
    await user.click(screen.getByRole('treeitem', { name: 'scripts' }))
    await user.click(screen.getByRole('treeitem', { name: 'setup.ts' }))

    const codeViewer = await screen.findByText('code viewer: export const setup = true')
    expect(codeViewer).toHaveAttribute('data-expanded', 'false')
    expect(codeViewer).toHaveAttribute('data-height', '100%')
    expect(readSkillFileMock).toHaveBeenLastCalledWith('skill-1', 'scripts/setup.ts')
    expect(screen.queryByRole('button', { name: 'library.skill_detail.translate_to_chinese' })).not.toBeInTheDocument()
  })

  it('translates the selected Markdown preview to Chinese without changing the source file', async () => {
    const user = userEvent.setup()
    render(<SkillFileBrowser skillId="skill-1" />)

    await screen.findByText('markdown: # Review Helper')
    await user.click(screen.getByRole('button', { name: 'library.skill_detail.translate_to_chinese' }))

    await waitFor(() => expect(translateMock).toHaveBeenCalledWith('# Review Helper', 'zh-cn'))
    expect(await screen.findByText('markdown: # 审查助手')).toBeInTheDocument()
    expect(readSkillFileMock).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'library.skill_detail.show_original' }))
    expect(await screen.findByText('markdown: # Review Helper')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'library.skill_detail.show_translation' })).toBeInTheDocument()
  })

  it('shows a localized error when a selected file cannot be read', async () => {
    readSkillFileMock.mockResolvedValueOnce({ success: false, error: 'read failed' })
    render(<SkillFileBrowser skillId="skill-1" />)

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('library.skill_detail.file_load_failed'))
  })
})
