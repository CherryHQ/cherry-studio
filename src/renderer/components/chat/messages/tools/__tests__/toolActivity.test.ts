import { describe, expect, it } from 'vitest'

import { AgentToolsType } from '../agent/types'
import { getAgentToolLabel, getReadableToolActivity } from '../toolActivity'

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
  'message.tools.labels.readFile': 'View file',
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

describe('getAgentToolLabel', () => {
  it('returns localized labels for known tools', () => {
    expect(getAgentToolLabel(AgentToolsType.Read, t)).toBe('View file')
  })

  it('falls back to the raw tool name for unknown tools', () => {
    expect(getAgentToolLabel('UnknownTool', t)).toBe('UnknownTool')
  })
})

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
