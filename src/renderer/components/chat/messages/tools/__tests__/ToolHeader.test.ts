import { render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'

import { AgentToolsType } from '../shared/agentToolTypes'
import ToolHeader, { getReadableToolActivity } from '../ToolHeader'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => options?.defaultValue ?? key
  })
}))

const translations: Record<string, string> = {
  'message.tools.activity.archive': 'archive',
  'message.tools.activity.assistantTask': 'task',
  'message.tools.activity.availableFeatures': 'available features',
  'message.tools.activity.building': 'Building',
  'message.tools.activity.checking': 'Checking',
  'message.tools.activity.codeFiles': 'program files',
  'message.tools.activity.codeHostInfo': 'online project information',
  'message.tools.activity.configFiles': 'project docs and settings',
  'message.tools.activity.copying': 'Copying',
  'message.tools.activity.currentFolder': 'current folder',
  'message.tools.activity.documentFiles': 'document files',
  'message.tools.activity.downloading': 'Downloading',
  'message.tools.activity.environmentInfo': 'environment information',
  'message.tools.activity.executingCommand': 'Running task',
  'message.tools.activity.file': 'file',
  'message.tools.activity.fileList': 'file list',
  'message.tools.activity.handling': 'Handling',
  'message.tools.activity.installing': 'Installing',
  'message.tools.activity.matchingFiles': 'matching files',
  'message.tools.activity.opening': 'Opening',
  'message.tools.activity.projectDependencies': 'project requirements',
  'message.tools.activity.projectTask': 'project task',
  'message.tools.activity.projectRootFiles': 'top-level project files',
  'message.tools.activity.relatedContent': 'related content',
  'message.tools.activity.repository': 'project content',
  'message.tools.activity.searching': 'Finding',
  'message.tools.activity.starting': 'Starting',
  'message.tools.activity.syncing': 'Syncing',
  'message.tools.activity.taskId': 'Task {{id}}',
  'message.tools.activity.taskList': 'task list',
  'message.tools.activity.viewing': 'Viewing',
  'message.tools.activity.webPage': 'web page',
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
      description: 'project requirements'
    })
  })

  it('turns downloads into friendly download progress', () => {
    expect(
      getReadableToolActivity(AgentToolsType.Bash, { command: 'curl https://example.com/releases/app.zip' }, true, t)
    ).toEqual({
      label: 'Downloading',
      description: 'archive'
    })
  })

  it('recognizes common project navigation descriptions', () => {
    expect(getReadableToolActivity(AgentToolsType.Bash, { description: 'List root directory files' }, true, t)).toEqual(
      {
        label: 'Viewing',
        description: 'top-level project files'
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
      description: 'project docs and settings'
    })

    expect(getReadableToolActivity(AgentToolsType.Glob, { pattern: '*.md' }, true, t)).toEqual({
      label: 'Finding',
      description: 'document files'
    })
  })

  it('turns version checks into readable environment information', () => {
    expect(getReadableToolActivity(AgentToolsType.Bash, { command: 'node --version' }, true, t)).toEqual({
      label: 'Viewing',
      description: 'environment information'
    })
  })

  it('does not expose unknown shell commands in the activity title', () => {
    expect(
      getReadableToolActivity(AgentToolsType.Bash, { command: 'custom-internal-cli deploy --production' }, true, t)
    ).toEqual({
      label: 'Running task',
      description: 'project task'
    })
  })

  it('uses readable categories instead of technical file names and addresses', () => {
    expect(
      getReadableToolActivity(AgentToolsType.Read, { file_path: '/src/MessagePartsRenderer.tsx' }, true, t)
    ).toEqual({
      label: 'Viewing',
      description: 'program files'
    })

    expect(
      getReadableToolActivity(AgentToolsType.WebFetch, { url: 'https://api.example.com/v1/models' }, true, t)
    ).toEqual({
      label: 'Viewing',
      description: 'web page'
    })
  })

  it('hides internal skill names and tool search queries', () => {
    expect(getReadableToolActivity(AgentToolsType.Skill, { skill: 'cherry-code-review' }, true, t)).toEqual({
      label: 'Handling',
      description: 'task'
    })

    expect(getReadableToolActivity(AgentToolsType.ToolSearch, { query: 'mcp__internal__search' }, true, t)).toEqual({
      label: 'Finding',
      description: 'available features'
    })
  })

  it('describes source control and search commands without exposing their syntax', () => {
    expect(getReadableToolActivity(AgentToolsType.Bash, { command: 'gh api repos/org/private-repo' }, true, t)).toEqual(
      {
        label: 'Viewing',
        description: 'online project information'
      }
    )

    expect(getReadableToolActivity(AgentToolsType.Bash, { command: 'rg secretPattern src' }, true, t)).toEqual({
      label: 'Finding',
      description: 'related content'
    })
  })

  it('describes common project start commands as a user-facing action', () => {
    expect(getReadableToolActivity(AgentToolsType.Bash, { command: 'pnpm dev' }, true, t)).toEqual({
      label: 'Starting',
      description: 'project task'
    })

    expect(getReadableToolActivity(AgentToolsType.Bash, { command: 'pnpm start' }, true, t)).toEqual({
      label: 'Starting',
      description: 'project task'
    })

    expect(getReadableToolActivity(AgentToolsType.Bash, { command: 'vite dev' }, true, t)).toEqual({
      label: 'Starting',
      description: 'project task'
    })
  })

  it('recognizes Windows start only at the beginning of the command', () => {
    expect(getReadableToolActivity(AgentToolsType.Bash, { command: 'start README.md' }, true, t)).toMatchObject({
      label: 'Opening'
    })
    expect(getReadableToolActivity(AgentToolsType.Bash, { command: 'echo start README.md' }, true, t)?.label).not.toBe(
      'Opening'
    )
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
    expect(container.querySelector('.animation-shimmer')).not.toHaveTextContent('message.tools.activity.codeFiles')
    expect(container).toHaveTextContent('message.tools.activity.codeFiles')
    expect(container).not.toHaveTextContent('unifiedPanel.test.ts')
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
    expect(commandPreview.querySelector('span')).toBeNull()
  })

  it('uses a plain neutral style for command previews', () => {
    render(
      React.createElement(ToolHeader, {
        args: { command: 'gh pr view 16600 --json title' },
        status: 'invoking',
        toolName: AgentToolsType.Bash,
        variant: 'collapse-label'
      })
    )

    const commandPreview = screen.getByTestId('tool-command-preview')
    expect(commandPreview).toHaveClass('bg-background-subtle', 'text-foreground-secondary')
    expect(commandPreview.querySelector('span')).toBeNull()
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
    expect(commandPreview.querySelector('span')).toBeNull()
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
