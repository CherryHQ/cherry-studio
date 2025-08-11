import ObsidianExportPopup from '@renderer/components/Popups/ObsidianExportPopup'
import { getMessageTitle } from '@renderer/services/MessagesService'
import { RootState } from '@renderer/store'
import { Message, Topic } from '@renderer/types'
import { captureScrollableDivAsBlob, captureScrollableDivAsDataURL } from '@renderer/utils'
import { copyMessageAsPlainText } from '@renderer/utils/copy'
import {
  exportMarkdownToJoplin,
  exportMarkdownToSiyuan,
  exportMarkdownToYuque,
  exportMessageAsMarkdown,
  exportMessageToNotion,
  messageToMarkdown
} from '@renderer/utils/export'
import { t } from 'i18next'
import { useMemo } from 'react'
import { useSelector } from 'react-redux'

export const useExportActions = (
  message: Message,
  topic: Topic,
  messageContainerRef: React.RefObject<HTMLDivElement>
) => {
  const exportMenuOptions = useSelector((state: RootState) => state.settings.exportMenuOptions)

  const exportActions = useMemo(
    () => ({
      copyPlainText: () => copyMessageAsPlainText(message),
      copyImage: async () => {
        await captureScrollableDivAsBlob(messageContainerRef, async (blob) => {
          if (blob) {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          }
        })
      },
      exportImage: async () => {
        const imageData = await captureScrollableDivAsDataURL(messageContainerRef)
        const title = await getMessageTitle(message)
        if (title && imageData) {
          window.api.file.saveImage(title, imageData)
        }
      },
      exportMarkdown: () => exportMessageAsMarkdown(message),
      exportMarkdownWithReasoning: () => exportMessageAsMarkdown(message, true),
      exportWord: async () => {
        const markdown = messageToMarkdown(message)
        const title = await getMessageTitle(message)
        window.api.export.toWord(markdown, title)
      },
      exportNotion: async () => {
        const title = await getMessageTitle(message)
        const markdown = messageToMarkdown(message)
        exportMessageToNotion(title, markdown, message)
      },
      exportYuque: async () => {
        const title = await getMessageTitle(message)
        const markdown = messageToMarkdown(message)
        exportMarkdownToYuque(title, markdown)
      },
      exportObsidian: async () => {
        const title = topic.name?.replace(/\//g, '_') || 'Untitled'
        await ObsidianExportPopup.show({ title, message, processingMethod: '1' })
      },
      exportJoplin: async () => {
        const title = await getMessageTitle(message)
        exportMarkdownToJoplin(title, message)
      },
      exportSiyuan: async () => {
        const title = await getMessageTitle(message)
        const markdown = messageToMarkdown(message)
        exportMarkdownToSiyuan(title, markdown)
      }
    }),
    [message, topic]
  )

  const exportMenuItems = useMemo(
    () =>
      [
        exportMenuOptions.plain_text && {
          label: t('chat.topics.copy.plain_text'),
          key: 'copy_message_plain_text',
          onClick: exportActions.copyPlainText
        },
        exportMenuOptions.image && {
          label: t('chat.topics.copy.image'),
          key: 'img',
          onClick: exportActions.copyImage
        },
        exportMenuOptions.image && {
          label: t('chat.topics.export.image'),
          key: 'image',
          onClick: exportActions.exportImage
        },
        exportMenuOptions.markdown && {
          label: t('chat.topics.export.md.label'),
          key: 'markdown',
          onClick: exportActions.exportMarkdown
        },
        exportMenuOptions.markdown_reason && {
          label: t('chat.topics.export.md.reason'),
          key: 'markdown_reason',
          onClick: exportActions.exportMarkdownWithReasoning
        },
        exportMenuOptions.docx && {
          label: t('chat.topics.export.word'),
          key: 'word',
          onClick: exportActions.exportWord
        },
        exportMenuOptions.notion && {
          label: t('chat.topics.export.notion'),
          key: 'notion',
          onClick: exportActions.exportNotion
        },
        exportMenuOptions.yuque && {
          label: t('chat.topics.export.yuque'),
          key: 'yuque',
          onClick: exportActions.exportYuque
        },
        exportMenuOptions.obsidian && {
          label: t('chat.topics.export.obsidian'),
          key: 'obsidian',
          onClick: exportActions.exportObsidian
        },
        exportMenuOptions.joplin && {
          label: t('chat.topics.export.joplin'),
          key: 'joplin',
          onClick: exportActions.exportJoplin
        },
        exportMenuOptions.siyuan && {
          label: t('chat.topics.export.siyuan'),
          key: 'siyuan',
          onClick: exportActions.exportSiyuan
        }
      ].filter(Boolean),
    [exportActions]
  )

  return { exportMenuItems }
}
