import { loggerService } from '@logger'
import AiProvider from '@renderer/aiCore'
import { CompletionsParams } from '@renderer/aiCore/middleware/schemas'
import { getAiTranslateAssistant, getAssistantProvider, getDefaultAssistant } from '@renderer/services/AssistantService'
import { createStreamProcessor } from '@renderer/services/StreamProcessingService'
import type { Assistant, TranslateLanguage } from '@renderer/types'
import type { Chunk } from '@renderer/types/chunk'
import { markdownToHtml } from '@renderer/utils/markdownConverter'
import { Editor, Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { v4 as uuidv4 } from 'uuid'

import { getLastChars } from './utils'

const logger = loggerService.withContext('TipTapAI')

export interface AiStreamResolverParams {
  action: 'generate' | 'complete' | 'improve' | 'summarize' | 'translate' | 'fixSpelling'
  text: string
  textOptions?: {
    from?: number
    to?: number
  }
}

type TextSource =
  | 'selection' // 选中的文本
  | 'selectionOrAll' // 选中的文本，如果没选中则全部文档
  | 'beforeCursor' // 光标前的文本
  | 'afterCursor' // 光标后的文本
  | 'currentNode' // 当前节点的文本
  | 'currentParagraph' // 当前段落的文本
  | 'wholeDocument' // 整个文档的文本
  | 'custom' // 自定义获取逻辑

interface TextSourceConfig {
  source: TextSource
  customExtractor?: (editor: any) => string
}

interface AiExtensionOptions {
  // Cherry Studio specific options
  assistant?: Assistant

  // AI assistants for different actions
  generateAssistant?: Assistant
  completeAssistant?: Assistant
  improveAssistant?: Assistant
  summarizeAssistant?: Assistant
  translateAssistant?: Assistant
  fixSpellingAssistant?: Assistant

  // Text source configuration for each action
  textSourceConfig?: {
    generate?: TextSourceConfig
    complete?: TextSourceConfig
    improve?: TextSourceConfig
    summarize?: TextSourceConfig
    translate?: TextSourceConfig
    fixSpelling?: TextSourceConfig
  }

  // TipTap AI compatible options
  appId?: string
  token?: string
  baseUrl?: string
  autocompletion?: boolean

  // AI Completion Trigger Mode
  completionTriggerMode?: 'manual' | 'auto' | 'hybrid' // 新增：补全触发模式
  autoCompletionDelay?: number // 新增：自动补全延迟(ms)
  minTextLength?: number // 新增：触发补全的最小文本长度

  // Stream resolver function (user customizable)
  aiStreamResolver?: (params: AiStreamResolverParams) => Promise<void>

  // Callback functions
  onLoading?: () => void
  onChunk?: (response: { response: string }) => void
  onSuccess?: (response: { response: string }) => void
  onError?: (error: Error) => void
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    ai: {
      aiGenerate: (options: { prompt: string; insertAt?: number }) => ReturnType
      aiComplete: (options: { text?: string; insertAt?: number }) => ReturnType
      aiImprove: (options: { text?: string; replaceSelection?: boolean }) => ReturnType
      aiSummarize: (options: { text?: string; insertAt?: number }) => ReturnType
      aiTranslate: (options: {
        text?: string
        replaceSelection?: boolean
        targetLanguage?: TranslateLanguage
      }) => ReturnType
      aiFixSpelling: (options: { text?: string; replaceSelection?: boolean }) => ReturnType
      aiAccept: () => ReturnType
      aiReject: () => ReturnType
      aiRegenerate: () => ReturnType
    }
  }
}

// AI state global storage
const aiState = {
  aiGenerating: false,
  currentAiRequestId: null as string | null,
  accumulatedResponse: '',
  insertPosition: null as number | null,
  // AI completion preview state
  previewText: '',
  previewPosition: null as number | null,
  isPreviewActive: false,
  // Auto completion state
  autoCompletionTimer: null as NodeJS.Timeout | null,
  lastTextContent: '',
  lastCursorPosition: 0
}

// Text extraction utility function
function extractText(editor: any, config?: TextSourceConfig, fallbackText?: string): string {
  if (fallbackText) return fallbackText

  if (!config) {
    // Default behavior: selection or whole document
    return editor.state.selection.empty
      ? editor.state.doc.textContent
      : editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)
  }

  const { source, customExtractor } = config

  switch (source) {
    case 'selection':
      return editor.state.selection.empty
        ? ''
        : editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)

    case 'selectionOrAll':
      return editor.state.selection.empty
        ? editor.state.doc.textContent
        : editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)

    case 'beforeCursor':
      return editor.state.doc.textBetween(0, editor.state.selection.from)

    case 'afterCursor':
      return editor.state.doc.textBetween(editor.state.selection.to, editor.state.doc.content.size)

    case 'currentNode': {
      const node = editor.state.selection.$from.node()
      return node.textContent || ''
    }

    case 'currentParagraph': {
      const $pos = editor.state.selection.$from
      const start = $pos.start($pos.depth)
      const end = $pos.end($pos.depth)
      return editor.state.doc.textBetween(start, end)
    }
    case 'wholeDocument':
      return editor.state.doc.textContent

    case 'custom':
      return customExtractor ? customExtractor(editor) : ''

    default:
      return editor.state.doc.textContent
  }
}

// Built-in stream resolver function
async function builtInStreamResolver(
  params: {
    assistant: Assistant
    text: string
    editor: any
    insertAt?: number
    replaceSelection?: boolean
  },
  options: AiExtensionOptions
) {
  try {
    const { assistant: targetAssistant, text, editor, insertAt, replaceSelection = false } = params

    logger.debug('AI stream resolver called', {
      assistant: targetAssistant.name,
      text,
      insertAt,
      replaceSelection
    })

    const provider = getAssistantProvider(targetAssistant)
    if (!provider) {
      throw new Error('No provider available for assistant')
    }

    aiState.aiGenerating = true
    aiState.currentAiRequestId = uuidv4()
    aiState.accumulatedResponse = ''

    options.onLoading?.()

    let insertPosition: number
    if (insertAt !== undefined) {
      insertPosition = insertAt
    } else if (replaceSelection && !editor.state.selection.empty) {
      insertPosition = editor.state.selection.from
      editor.commands.deleteSelection()
    } else {
      insertPosition = editor.state.selection.from
    }

    aiState.insertPosition = insertPosition

    const streamProcessor = createStreamProcessor({
      onTextChunk: (chunk: string) => {
        if (!aiState.aiGenerating) return

        aiState.accumulatedResponse = chunk
        const from = aiState.insertPosition!
        const to = from + (aiState.accumulatedResponse.length - chunk.length)

        editor.view.dispatch(editor.state.tr.insertText(chunk, to).setMeta('aiChunk', true).setMeta('fromAI', true))
        options.onChunk?.({ response: aiState.accumulatedResponse })
        logger.debug('Text chunk rendered to editor', { chunk, total: aiState.accumulatedResponse })
      },
      onTextComplete: (text: string) => {
        aiState.accumulatedResponse = text
        aiState.aiGenerating = false
        editor.view.dispatch(editor.state.tr.setMeta('aiComplete', true).setMeta('fromAI', true))
        options.onSuccess?.({ response: text })
        logger.debug('Text complete rendered to editor', { text })
      },
      onError: (error: any) => {
        aiState.aiGenerating = false
        aiState.currentAiRequestId = null
        logger.error('Stream processing error', error)
        options.onError?.(error)
      }
    })

    const aiProvider = new AiProvider(provider)
    const completionParams: CompletionsParams = {
      assistant: targetAssistant,
      messages: text,
      enableWebSearch: false,
      enableUrlContext: false,
      streamOutput: true,
      onChunk: (chunk: Chunk) => {
        streamProcessor(chunk)
      }
    }

    await aiProvider.completions(completionParams)
    return true
  } catch (error) {
    aiState.aiGenerating = false
    aiState.currentAiRequestId = null
    logger.error('AI stream resolver error', error as Error)
    options.onError?.(error as Error)
    return false
  }
}

// Execute custom resolver function
async function executeCustomResolver(params: AiStreamResolverParams, options: AiExtensionOptions) {
  if (options.aiStreamResolver) {
    options.onLoading?.()
    try {
      await options.aiStreamResolver(params)
    } catch (error) {
      options.onError?.(error as Error)
    }
  }
}

// Generate AI completion preview
async function generateCompletionPreview(editor: Editor, assistant: Assistant, text: string, position: number) {
  try {
    logger.info('generateCompletionPreview called', { text, position, assistantId: assistant.id })

    // 清除之前的预览
    clearCompletionPreview(editor)

    aiState.isPreviewActive = true
    // 确保位置是当前光标位置
    const currentPos = editor.state.selection.from
    aiState.previewPosition = currentPos

    logger.info('Preview position set to:', { originalPosition: position, currentPosition: currentPos })

    const provider = getAssistantProvider(assistant)

    const aiProvider = new AiProvider(provider)

    const streamProcessor = createStreamProcessor({
      onTextChunk: (chunk: string) => {
        aiState.previewText = chunk

        // Trigger view update to show preview
        editor.view.dispatch(editor.state.tr.setMeta('aiPreviewUpdate', true))
      },
      onTextComplete: (text: string) => {
        aiState.previewText = text
        aiState.accumulatedResponse = text

        editor.view.dispatch(editor.state.tr.setMeta('aiPreviewComplete', true))
      },
      onError: (error: any) => {
        logger.error('AI completion preview error', error)
        aiState.isPreviewActive = false
        aiState.previewText = ''
        editor.view.dispatch(editor.state.tr.setMeta('aiPreviewError', true))
      }
    })

    const completionParams: CompletionsParams = {
      assistant,
      messages: getLastChars(text, 100),
      enableWebSearch: false,
      enableUrlContext: false,
      streamOutput: true,
      maxTokens: 50,
      onChunk: (chunk: Chunk) => {
        streamProcessor(chunk)
      }
    }

    logger.info('Starting AI completion request', { completionParams })
    await aiProvider.completions(completionParams)
    logger.info('AI completion request completed')
  } catch (error) {
    logger.error('AI completion preview error', error as Error)
    aiState.isPreviewActive = false
    aiState.previewText = ''
  }
}

// Accept AI completion preview
function acceptCompletionPreview(editor: Editor) {
  if (aiState.isPreviewActive && aiState.previewPosition !== null) {
    const from = aiState.previewPosition
    // 使用完整的累积响应，而不是预览文本
    const textToInsert = aiState.accumulatedResponse

    // Clear the preview first to remove the widget decoration before inserting text
    clearCompletionPreview(editor)

    if (textToInsert) {
      const text = markdownToHtml(textToInsert)
      editor.commands.insertContentAt(from, text)
    }

    return true
  }
  return false
}

// Clear AI completion preview
function clearCompletionPreview(editor: any) {
  aiState.isPreviewActive = false
  aiState.previewText = ''
  aiState.previewPosition = null
  editor.view.dispatch(editor.state.tr.setMeta('aiPreviewClear', true))
}

// Clear auto completion timer
function clearAutoCompletionTimer() {
  if (aiState.autoCompletionTimer) {
    clearTimeout(aiState.autoCompletionTimer)
    aiState.autoCompletionTimer = null
  }
}

export const Ai = Extension.create<AiExtensionOptions>({
  name: 'ai',

  addOptions() {
    return {
      // Cherry Studio specific options
      assistant: undefined,
      generateAssistant: undefined,
      completeAssistant: undefined,
      improveAssistant: undefined,
      summarizeAssistant: undefined,
      translateAssistant: undefined,
      fixSpellingAssistant: undefined,

      // TipTap AI compatible options
      experimental__streamV2: false,
      appId: undefined,
      token: undefined,
      baseUrl: undefined,
      autocompletion: false,

      // AI Completion Trigger Mode
      completionTriggerMode: 'manual',
      autoCompletionDelay: 1000,
      minTextLength: 10,

      // Stream resolver function (user customizable)
      aiStreamResolver: undefined,

      // Callback functions
      onLoading: undefined,
      onChunk: undefined,
      onSuccess: undefined,
      onError: undefined
    }
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        logger.info('Tab key pressed in AI extension')

        // Accept current AI completion preview
        if (aiState.isPreviewActive) {
          logger.info('Accepting current AI completion preview')
          return acceptCompletionPreview(this.editor)
        }

        // Generate new AI completion preview
        const { selection } = this.editor.state
        const { from } = selection

        // Extract text before cursor for completion
        const text = extractText(this.editor, this.options.textSourceConfig?.complete || { source: 'beforeCursor' })
        logger.info('Extracted text for completion:', { text, textLength: text.length })

        if (text.trim()) {
          const targetAssistant = this.options.completeAssistant || this.options.assistant || getDefaultAssistant()
          logger.info('Starting AI completion preview with assistant:', {
            assistantId: targetAssistant.id,
            assistantName: targetAssistant.name
          })
          generateCompletionPreview(this.editor, targetAssistant, text, from)
          return true
        }

        logger.warn('No text available for completion')
        return false
      },
      Escape: () => {
        // Clear AI completion preview on Escape
        if (aiState.isPreviewActive) {
          logger.info('Clearing AI completion preview')
          clearCompletionPreview(this.editor)
          return true
        }
        return false
      }
    }
  },

  addProseMirrorPlugins() {
    return [
      // AI completion preview decoration plugin
      new Plugin({
        key: new PluginKey('ai-completion-preview'),
        state: {
          init() {
            return DecorationSet.empty
          },
          apply(tr, oldState) {
            // Check if we need to update decorations based on meta
            const hasPreviewUpdate =
              tr.getMeta('aiPreviewUpdate') ||
              tr.getMeta('aiPreviewComplete') ||
              tr.getMeta('aiPreviewError') ||
              tr.getMeta('aiPreviewClear')

            if (hasPreviewUpdate) {
              const decorations: Decoration[] = []

              // Only show preview when active and has content
              if (aiState.isPreviewActive && aiState.previewText && aiState.previewPosition !== null) {
                const pos = aiState.previewPosition

                // Create decoration for AI completion preview
                const decoration = Decoration.widget(pos, () => {
                  const span = document.createElement('span')
                  span.className = 'ai-completion-preview'
                  span.setAttribute('data-placeholder', aiState.previewText)
                  return span
                })

                decorations.push(decoration)
              }

              return DecorationSet.create(tr.doc, decorations)
            }

            // Map decorations through document changes
            return oldState.map(tr.mapping, tr.doc)
          }
        },
        props: {
          decorations(state) {
            return this.getState(state)
          }
        }
      }),
      // Auto completion trigger plugin
      new Plugin({
        key: new PluginKey('ai-auto-completion'),
        props: {
          handleTextInput: () => {
            // Handle text input for auto completion
            const triggerMode = this.options.completionTriggerMode || 'manual'

            if (triggerMode === 'auto' || triggerMode === 'hybrid') {
              // Clear existing preview when user types
              if (aiState.isPreviewActive) {
                clearCompletionPreview(this.editor)
              }

              // Schedule auto completion
              clearAutoCompletionTimer()

              const delay = this.options.autoCompletionDelay || 1000
              const minLength = this.options.minTextLength || 10

              aiState.autoCompletionTimer = setTimeout(() => {
                const { selection } = this.editor.state
                const { from } = selection

                const extractedText = extractText(
                  this.editor,
                  this.options.textSourceConfig?.complete || { source: 'beforeCursor' }
                )

                // Only trigger if text is long enough and has changed
                if (extractedText.trim().length >= minLength && extractedText !== aiState.lastTextContent) {
                  aiState.lastTextContent = extractedText
                  aiState.lastCursorPosition = from

                  const targetAssistant =
                    this.options.completeAssistant || this.options.assistant || getDefaultAssistant()
                  logger.info('Auto-triggering completion preview', { textLength: extractedText.length })
                  generateCompletionPreview(this.editor, targetAssistant, extractedText, from)
                }
              }, delay)
            }

            return false // Don't prevent default behavior
          }
        }
      })
    ]
  },

  addCommands() {
    return {
      aiGenerate:
        (genOptions: { prompt: string; insertAt?: number }) =>
        ({ editor }) => {
          if (this.options.aiStreamResolver) {
            executeCustomResolver(
              {
                action: 'generate',
                text: genOptions.prompt,
                textOptions: { from: genOptions.insertAt }
              },
              this.options
            )
          } else {
            const targetAssistant = this.options.generateAssistant || this.options.assistant || getDefaultAssistant()
            builtInStreamResolver(
              {
                assistant: targetAssistant,
                text: genOptions.prompt,
                editor,
                insertAt: genOptions.insertAt
              },
              this.options
            )
          }
          return true
        },
      aiComplete:
        (compOptions: { text?: string; insertAt?: number }) =>
        ({ editor }) => {
          const text = extractText(
            editor,
            this.options.textSourceConfig?.complete || { source: 'beforeCursor' },
            compOptions.text
          )

          if (this.options.aiStreamResolver) {
            executeCustomResolver(
              {
                action: 'complete',
                text,
                textOptions: { from: compOptions.insertAt }
              },
              this.options
            )
          } else {
            const targetAssistant = this.options.completeAssistant || this.options.assistant || getDefaultAssistant()
            builtInStreamResolver(
              {
                assistant: targetAssistant,
                text,
                editor,
                insertAt: compOptions.insertAt
              },
              this.options
            )
          }
          return true
        },
      aiImprove:
        (impOptions: { text?: string; replaceSelection?: boolean }) =>
        ({ editor }) => {
          const text = extractText(
            editor,
            this.options.textSourceConfig?.improve || { source: 'selectionOrAll' },
            impOptions.text
          )

          if (this.options.aiStreamResolver) {
            executeCustomResolver(
              {
                action: 'improve',
                text,
                textOptions: {}
              },
              this.options
            )
          } else {
            const targetAssistant = this.options.improveAssistant || this.options.assistant || getDefaultAssistant()
            builtInStreamResolver(
              {
                assistant: targetAssistant,
                text,
                editor,
                replaceSelection: impOptions.replaceSelection !== false
              },
              this.options
            )
          }
          return true
        },
      aiSummarize:
        (sumOptions: { text?: string; insertAt?: number }) =>
        ({ editor }) => {
          const text = extractText(
            editor,
            this.options.textSourceConfig?.summarize || { source: 'selectionOrAll' },
            sumOptions.text
          )

          if (this.options.aiStreamResolver) {
            executeCustomResolver(
              {
                action: 'summarize',
                text,
                textOptions: { from: sumOptions.insertAt }
              },
              this.options
            )
          } else {
            const targetAssistant = this.options.summarizeAssistant || this.options.assistant || getDefaultAssistant()
            builtInStreamResolver(
              {
                assistant: targetAssistant,
                text,
                editor,
                insertAt: sumOptions.insertAt
              },
              this.options
            )
          }
          return true
        },
      aiTranslate:
        (transOptions: { text?: string; replaceSelection?: boolean; targetLanguage?: TranslateLanguage }) =>
        ({ editor }) => {
          const text = extractText(
            editor,
            this.options.textSourceConfig?.translate || { source: 'selectionOrAll' },
            transOptions.text
          )

          if (this.options.aiStreamResolver) {
            executeCustomResolver(
              {
                action: 'translate',
                text,
                textOptions: {}
              },
              this.options
            )
          } else {
            let targetAssistant: Assistant

            // 动态创建翻译助手 - 如果提供了目标语言则创建动态助手
            if (transOptions.targetLanguage) {
              targetAssistant = getAiTranslateAssistant(transOptions.targetLanguage, text)
            } else {
              // 如果没有提供目标语言，使用预配置的助手或默认助手
              targetAssistant = this.options.translateAssistant || this.options.assistant || getDefaultAssistant()
            }

            builtInStreamResolver(
              {
                assistant: targetAssistant,
                text,
                editor,
                replaceSelection: transOptions.replaceSelection !== false
              },
              this.options
            )
          }
          return true
        },
      aiFixSpelling:
        (fixOptions: { text?: string; replaceSelection?: boolean }) =>
        ({ editor }) => {
          const text = extractText(
            editor,
            this.options.textSourceConfig?.fixSpelling || { source: 'selectionOrAll' },
            fixOptions.text
          )

          if (this.options.aiStreamResolver) {
            executeCustomResolver(
              {
                action: 'fixSpelling',
                text,
                textOptions: {}
              },
              this.options
            )
          } else {
            const targetAssistant = this.options.fixSpellingAssistant || this.options.assistant || getDefaultAssistant()
            builtInStreamResolver(
              {
                assistant: targetAssistant,
                text,
                editor,
                replaceSelection: fixOptions.replaceSelection !== false
              },
              this.options
            )
          }
          return true
        },
      aiAccept:
        () =>
        ({ editor }) => {
          aiState.aiGenerating = false
          aiState.currentAiRequestId = null
          aiState.insertPosition = null
          editor.view.dispatch(editor.state.tr.setMeta('aiAccepted', true))
          this.options.onSuccess?.({ response: aiState.accumulatedResponse })
          return true
        },
      aiReject:
        () =>
        ({ editor }) => {
          if (aiState.insertPosition !== null) {
            const from = aiState.insertPosition
            const to = from + aiState.accumulatedResponse.length
            editor.commands.deleteRange({ from, to })
          }
          aiState.aiGenerating = false
          aiState.currentAiRequestId = null
          aiState.accumulatedResponse = ''
          aiState.insertPosition = null
          return true
        },
      aiRegenerate:
        () =>
        ({ editor }) => {
          if (aiState.currentAiRequestId) {
            if (aiState.insertPosition !== null) {
              const from = aiState.insertPosition
              const to = from + aiState.accumulatedResponse.length
              editor.commands.deleteRange({ from, to })
            }
            return true
          }
          return false
        }
    }
  }
})

export default Ai
