import { addNote } from '@renderer/services/NotesService'
import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'

import { getTitleFromString } from './utils'
import { messageToMarkdown, topicToMarkdown } from './markdown'

  try {
    const cleanedContent = content.replace(/^## 🤖 Assistant(\n|$)/m, '')
    await addNote(title, cleanedContent, folderPath)

    window.toast.success(i18n.t('message.success.notes.export'))
  } catch (error) {
    logger.error('导出到笔记失败:', error as Error)
    window.toast.error(i18n.t('message.error.notes.export'))
    throw error
  }
}

/**
 * 导出话题到笔记工作区
 * @param topic 要导出的话题
 * @param folderPath
 * @returns 创建的笔记节点
 */
export const exportTopicToNotes = async (topic: Topic, folderPath: string): Promise<void> => {
  try {
    const content = await topicToMarkdown(topic)
    await addNote(topic.name, content, folderPath)

    window.toast.success(i18n.t('message.success.notes.export'))
  } catch (error) {
    logger.error('导出到笔记失败:', error as Error)
    window.toast.error(i18n.t('message.error.notes.export'))
    throw error
  }
}

const exportNoteAsMarkdown = async (noteName: string, content: string): Promise<void> => {
  const markdown = `# ${noteName}\n\n${content}`
  const fileName = removeSpecialCharactersForFileName(noteName) + '.md'
  const result = await window.api.file.save(fileName, markdown)
  if (result) {
    window.toast.success(i18n.t('message.success.markdown.export.specified'))
  }
}

const getScrollableElement = (): HTMLElement | null => {
  const notesPage = document.querySelector('#notes-page')
  if (!notesPage) return null

  const allDivs = notesPage.querySelectorAll('div')
  for (const div of Array.from(allDivs)) {
    const style = window.getComputedStyle(div)
    if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
      if (div.querySelector('.ProseMirror')) {
        return div as HTMLElement
      }
    }
  }
  return null
}

const getScrollableRef = (): { current: HTMLElement } | null => {
  const element = getScrollableElement()
  if (!element) {
    window.toast.warning(i18n.t('notes.no_content_to_copy'))
    return null
  }
  return { current: element }
}

const exportNoteAsImageToClipboard = async (): Promise<void> => {
  const scrollableRef = getScrollableRef()
  if (!scrollableRef) return

  await captureScrollableAsBlob(scrollableRef, async (blob) => {
    if (blob) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      window.toast.success(i18n.t('common.copied'))
    }
  })
}

const exportNoteAsImageFile = async (noteName: string): Promise<void> => {
  const scrollableRef = getScrollableRef()
  if (!scrollableRef) return

  const dataUrl = await captureScrollableAsDataURL(scrollableRef)
  if (dataUrl) {
    const fileName = removeSpecialCharactersForFileName(noteName)
    await window.api.file.saveImage(fileName, dataUrl)
  }
}

interface NoteExportOptions {
  node: { name: string; externalPath: string }
  platform: 'markdown' | 'docx' | 'notion' | 'yuque' | 'obsidian' | 'joplin' | 'siyuan' | 'copyImage' | 'exportImage'
}

export const exportNote = async ({ node, platform }: NoteExportOptions): Promise<void> => {
  try {
    const content = await window.api.file.readExternal(node.externalPath)

    switch (platform) {
      case 'copyImage':
        return await exportNoteAsImageToClipboard()
      case 'exportImage':
        return await exportNoteAsImageFile(node.name)
      case 'markdown':
        return await exportNoteAsMarkdown(node.name, content)
      case 'docx':
        void window.api.export.toWord(`# ${node.name}\n\n${content}`, removeSpecialCharactersForFileName(node.name))
        return
      case 'notion':
        await exportMessageToNotion(node.name, content)
        return
      case 'yuque':
        await exportMarkdownToYuque(node.name, `# ${node.name}\n\n${content}`)
        return
      case 'obsidian': {
        const { default: ObsidianExportPopup } = await import('@renderer/components/Popups/ObsidianExportPopup')
        await ObsidianExportPopup.show({ title: node.name, processingMethod: '1', rawContent: content })
        return
      }
      case 'joplin':
        await exportMarkdownToJoplin(node.name, content)
        return
      case 'siyuan':
        await exportMarkdownToSiyuan(node.name, `# ${node.name}\n\n${content}`)
        return
    }
  } catch (error) {
    logger.error(`Failed to export note to ${platform}:`, error as Error)
    throw error
  }
}
