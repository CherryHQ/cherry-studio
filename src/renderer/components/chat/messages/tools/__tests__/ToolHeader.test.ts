import { render, screen } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentToolsType } from '../agent/types'
import ToolHeader, { getReadableToolActivity } from '../ToolHeader'

const mockThemeState = vi.hoisted(() => ({ theme: 'light' }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => options?.defaultValue ?? key
  })
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: mockThemeState.theme })
}))

const translations: Record<string, string> = {
  'message.tools.activity.availableFeatures': 'available features',
  'message.tools.activity.building': 'Building',
  'message.tools.activity.checking': 'Checking',
  'message.tools.activity.codeFiles': 'code files',
  'message.tools.activity.commandName': '{{name}} command',
  'message.tools.activity.configFiles': 'project docs and config files',
  'message.tools.activity.copying': 'Copying',
  'message.tools.activity.currentFolder': 'current folder',
  'message.tools.activity.documentFiles': 'document files',
  'message.tools.activity.downloading': 'Downloading',
  'message.tools.activity.executingCommand': 'Running command',
  'message.tools.activity.file': 'file',
  'message.tools.activity.fileList': 'file list',
  'message.tools.activity.installing': 'Installing',
  'message.tools.activity.matchingFiles': 'matching files',
  'message.tools.activity.projectDependencies': 'project dependencies',
  'message.tools.activity.projectRootFiles': 'project root files',
  'message.tools.activity.relatedContent': 'related content',
  'message.tools.activity.repository': 'code repository',
  'message.tools.activity.searching': 'Finding',
  'message.tools.activity.syncing': 'Syncing',
  'message.tools.activity.taskId': 'Task {{id}}',
  'message.tools.activity.taskList': 'task list',
  'message.tools.activity.viewing': 'Viewing',
  'message.tools.labels.taskCreate': 'Create task',
  'message.tools.labels.taskGet': 'View task',
  'message.tools.labels.taskList': 'List tasks',
  'message.tools.labels.taskOutput': 'View task output',
  'message.tools.labels.taskStop': 'Stop task',
  'message.tools.labels.taskUpdate': 'Update task'
}

const t = (key: string, options?: Record<string, string>) => {
  const template = translations[key] ?? key
  if (!options) return template
  return Object.entries(options).reduce((result, [name, value]) => result.replace(`{{${name}}}`, value), template)
}

describe('getReadableToolActivity', () => {
  it('turns package commands into install progress', () => {
    expect(getReadableToolActivity(AgentToolsType.Bash, { command: 'pnpm add lodash' }, true, t)).toEqual({
      label: 'Installing',
      description: 'lodash'
    })
  })

  it('turns downloads into friendly download progress', () => {
    expect(
      getReadableToolActivity(AgentToolsType.Bash, { command: 'curl https://example.com/releases/app.zip' }, true, t)
    ).toEqual({
      label: 'Downloading',
      description: 'app.zip'
    })
  })

  it('recognizes common project navigation descriptions', () => {
    expect(getReadableToolActivity(AgentToolsType.Bash, { description: 'List root directory files' }, true, t)).toEqual(
      {
        label: 'Viewing',
        description: 'project root files'
      }
    )
  })

  it('groups technical file patterns into readable file categories', () => {
    expect(
      getReadableToolActivity(
        AgentToolsType.Glob,
        { pattern: '**/{README.md,package.json,go.mod,Cargo.toml}' },
        true,
        t
      )
    ).toEqual({
      label: 'Finding',
      description: 'project docs and config files'
    })

    expect(getReadableToolActivity(AgentToolsType.Glob, { pattern: '*.md' }, true, t)).toEqual({
      label: 'Finding',
      description: 'document files'
    })
  })

  it('keeps opaque commands readable without exposing full shell text', () => {
    expect(getReadableToolActivity(AgentToolsType.Bash, { command: 'node --version' }, true, t)).toEqual({
      label: 'Running command',
      description: 'node command'
    })
  })

  it('uses explicit labels for SDK task tools', () => {
    expect(getReadableToolActivity(AgentToolsType.TaskCreate, { subject: 'Build launch deck' }, false, t)).toEqual({
      label: 'Create task',
      description: 'Build launch deck'
    })

    expect(getReadableToolActivity(AgentToolsType.TaskUpdate, { taskId: '1' }, false, t)).toEqual({
      label: 'Update task',
      description: 'Task 1'
    })
  })
})

describe('ToolHeader', () => {
  beforeEach(() => {
    mockThemeState.theme = 'light'
  })

  it('does not render a tool icon in collapsed tool titles', () => {
    const { container } = render(
      React.createElement(ToolHeader, {
        variant: 'collapse-label',
        status: 'invoking',
        toolName: AgentToolsType.Read
      })
    )

    expect(container.querySelector('.tool-icon')).toBeNull()
  })

  it('does not render a tool icon in completed collapsed tool titles', () => {
    const { container } = render(
      React.createElement(ToolHeader, {
        variant: 'collapse-label',
        status: 'done',
        toolName: AgentToolsType.Read
      })
    )

    expect(container.querySelector('.tool-icon')).toBeNull()
  })

  it('applies shimmer only to the main label while keeping the target text style', () => {
    const { container } = render(
      React.createElement(ToolHeader, {
        args: { file_path: '/tmp/unifiedPanel.test.ts' },
        shimmer: true,
        status: 'invoking',
        toolName: AgentToolsType.Read,
        variant: 'collapse-label'
      })
    )

    expect(container.querySelectorAll('.animation-shimmer')).toHaveLength(1)
    expect(container.querySelector('.animation-shimmer')).toHaveTextContent('message.tools.activity.viewing')
    expect(container.querySelector('.animation-shimmer')).not.toHaveTextContent('unifiedPanel.test.ts')
    expect(container).toHaveTextContent('unifiedPanel.test.ts')
  })

  it('shows command information for bash tool calls', () => {
    render(
      React.createElement(ToolHeader, {
        args: {
          command: 'pnpm test:renderer src/renderer/components/chat/messages/tools/__tests__/ToolHeader.test.ts'
        },
        status: 'invoking',
        toolName: AgentToolsType.Bash,
        variant: 'collapse-label'
      })
    )

    const commandPreview = screen.getByTestId('tool-command-preview')
    expect(commandPreview).toHaveTextContent(
      'pnpm test:renderer src/renderer/components/chat/messages/tools/__tests__/ToolHeader.test.ts'
    )
    expect(commandPreview).toHaveAttribute(
      'title',
      'pnpm test:renderer src/renderer/components/chat/messages/tools/__tests__/ToolHeader.test.ts'
    )
    expect(commandPreview.querySelector('span')).toHaveTextContent('pnpm')
  })

  it('uses light command preview colors in light theme', () => {
    render(
      React.createElement(ToolHeader, {
        args: { command: 'gh pr view 16600 --json title' },
        status: 'invoking',
        toolName: AgentToolsType.Bash,
        variant: 'collapse-label'
      })
    )

    const commandPreview = screen.getByTestId('tool-command-preview')
    expect(commandPreview.className).toContain('bg-[#f5f5f5]')
    expect(commandPreview.className).toContain('text-[#1e1e1e]')
    expect(commandPreview.className).not.toContain('bg-[#1e1e1e]')
    expect(commandPreview.className).not.toContain('text-[#d4d4d4]')
  })

  it('uses dark command preview colors in dark theme', () => {
    mockThemeState.theme = 'dark'

    render(
      React.createElement(ToolHeader, {
        args: { command: 'gh pr view 16600 --json title' },
        status: 'invoking',
        toolName: AgentToolsType.Bash,
        variant: 'collapse-label'
      })
    )

    const commandPreview = screen.getByTestId('tool-command-preview')
    expect(commandPreview.className).toContain('bg-[#1e1e1e]')
    expect(commandPreview.className).toContain('text-[#d4d4d4]')
    expect(commandPreview.className).not.toContain('bg-[#f5f5f5]')
    expect(commandPreview.className).not.toContain('text-[#1e1e1e]')
  })

  it('truncates long bash command information in tool call labels', () => {
    const command = `node scripts/generate-report.js --input ${'very-long-segment/'.repeat(16)}report.json --format markdown --include-details`

    render(
      React.createElement(ToolHeader, {
        args: { command },
        status: 'invoking',
        toolName: AgentToolsType.Bash,
        variant: 'collapse-label'
      })
    )

    const commandPreview = screen.getByTestId('tool-command-preview')
    expect(commandPreview.textContent?.length).toBeLessThanOrEqual(160)
    expect(commandPreview).toHaveTextContent(/…$/)
    expect(commandPreview).toHaveAttribute('title', command)
    expect(commandPreview).toHaveClass('truncate')
    expect(commandPreview).toHaveClass('hidden')
    expect(commandPreview).toHaveClass('sm:block')
    expect(commandPreview.className).toContain('max-w-[clamp(6rem,42vw,32rem)]')
    expect(commandPreview.className).toContain('shrink-[2]')
    expect(commandPreview.querySelectorAll('span').length).toBeGreaterThan(0)
  })

  it('truncates long chained bash commands at shell separators', () => {
    const firstCommand = `pnpm test:renderer ${'src/renderer/components/chat/messages/'.repeat(3)}ToolHeader.test.ts`
    const command = `${firstCommand} && pnpm lint && pnpm format`

    render(
      React.createElement(ToolHeader, {
        args: { command },
        status: 'invoking',
        toolName: AgentToolsType.Bash,
        variant: 'collapse-label'
      })
    )

    const commandPreview = screen.getByTestId('tool-command-preview')
    expect(commandPreview).toHaveTextContent(/…$/)
    expect(commandPreview).not.toHaveTextContent('pnpm lint')
    expect(commandPreview.textContent).not.toContain('&&')
    expect(commandPreview).toHaveAttribute('title', command)
  })

  it('truncates long bash commands at whitespace boundaries before falling back to hard cuts', () => {
    const command = `python scripts/process.py --input ${'nested-folder/'.repeat(12)}input.json --output dist/report.json`

    render(
      React.createElement(ToolHeader, {
        args: { command },
        status: 'invoking',
        toolName: AgentToolsType.Bash,
        variant: 'collapse-label'
      })
    )

    const commandPreview = screen.getByTestId('tool-command-preview')
    expect(commandPreview).toHaveTextContent(/…$/)
    expect(commandPreview.textContent?.endsWith('/…')).toBe(false)
    expect(commandPreview.textContent?.length).toBeLessThanOrEqual(160)
  })

  it('uses terminal shell highlighting for command previews', () => {
    render(
      React.createElement(ToolHeader, {
        args: { command: 'node scripts/build.js --mode "production"' },
        status: 'invoking',
        toolName: AgentToolsType.Bash,
        variant: 'collapse-label'
      })
    )

    const commandPreview = screen.getByTestId('tool-command-preview')
    const highlightedTokens = Array.from(commandPreview.querySelectorAll('span')).filter((node) =>
      node.getAttribute('style')?.includes('color')
    )
    expect(highlightedTokens.length).toBeGreaterThan(0)
    expect(commandPreview).toHaveTextContent('node scripts/build.js --mode "production"')
  })

  it('normalizes multiline bash commands before showing the command preview', () => {
    render(
      React.createElement(ToolHeader, {
        args: { command: 'pnpm lint \\\n  --filter renderer' },
        status: 'invoking',
        toolName: AgentToolsType.Bash,
        variant: 'collapse-label'
      })
    )

    const commandPreview = screen.getByTestId('tool-command-preview')
    expect(commandPreview).toHaveTextContent('pnpm lint \\ --filter renderer')
    expect(commandPreview).toHaveAttribute('title', 'pnpm lint \\ --filter renderer')
  })
})
