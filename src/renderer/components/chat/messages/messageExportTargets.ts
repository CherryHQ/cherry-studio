import type { MessageExportTarget } from '@renderer/types/messageExport'

import type { MessageListActions, MessageMenuExportOptions } from './types'

export const messageExportTargets: {
  target: MessageExportTarget
  option: keyof MessageMenuExportOptions
  labelKey: string
  group: 'file' | 'external'
  commandId: string
  action: keyof MessageListActions
}[] = [
  {
    target: 'markdown',
    option: 'markdown',
    labelKey: 'chat.topics.export.md.label',
    group: 'file',
    commandId: 'message.exportMarkdown',
    action: 'exportMessageAsMarkdown'
  },
  {
    target: 'markdown-reason',
    option: 'markdown_reason',
    labelKey: 'chat.topics.export.md.reason',
    group: 'file',
    commandId: 'message.exportMarkdownReason',
    action: 'exportMessageAsMarkdown'
  },
  {
    target: 'word',
    option: 'docx',
    labelKey: 'chat.topics.export.word',
    group: 'file',
    commandId: 'message.exportWord',
    action: 'exportToWord'
  },
  {
    target: 'notion',
    option: 'notion',
    labelKey: 'chat.topics.export.notion',
    group: 'external',
    commandId: 'message.exportNotion',
    action: 'exportToNotion'
  },
  {
    target: 'yuque',
    option: 'yuque',
    labelKey: 'chat.topics.export.yuque',
    group: 'external',
    commandId: 'message.exportYuque',
    action: 'exportToYuque'
  },
  {
    target: 'obsidian',
    option: 'obsidian',
    labelKey: 'chat.topics.export.obsidian',
    group: 'external',
    commandId: 'message.exportObsidian',
    action: 'exportToObsidian'
  },
  {
    target: 'joplin',
    option: 'joplin',
    labelKey: 'chat.topics.export.joplin',
    group: 'external',
    commandId: 'message.exportJoplin',
    action: 'exportToJoplin'
  },
  {
    target: 'siyuan',
    option: 'siyuan',
    labelKey: 'chat.topics.export.siyuan',
    group: 'external',
    commandId: 'message.exportSiyuan',
    action: 'exportToSiyuan'
  }
]
