/**
 * Configuration-driven factory for creating RichEditor instances.
 * This allows different editor configurations for different use cases
 * (notes, message editing, prompt editing, etc.)
 */

import type { Extension } from '@tiptap/core'
import type { FC } from 'react'
import React from 'react'

import { RichEditor } from './index'
import type { RichEditorProps, RichEditorRef } from './types'

/**
 * Editor configuration preset
 */
export interface RichEditorConfig {
  /** Unique identifier for this configuration */
  id: string
  /** Display name for this configuration */
  name: string
  /** Extensions to enable */
  extensions?: Extension[]
  /** Toolbar commands to show */
  toolbarCommands?: string[]
  /** Whether to show the toolbar */
  showToolbar?: boolean
  /** Whether to show the table of contents */
  showTableOfContents?: boolean
  /** Whether to enable drag and drop */
  enableDragDrop?: boolean
  /** Whether to enable link editing */
  enableLinkEditing?: boolean
  /** Whether to enable content search */
  enableContentSearch?: boolean
  /** Placeholder text */
  placeholder?: string
  /** Editor height */
  height?: string | number
  /** Whether the editor is read-only */
  readOnly?: boolean
  /** Custom CSS class */
  className?: string
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: RichEditorConfig = {
  id: 'default',
  name: 'Default Editor',
  showToolbar: true,
  showTableOfContents: false,
  enableDragDrop: true,
  enableLinkEditing: true,
  enableContentSearch: true,
  placeholder: 'Start typing...'
}

/**
 * Predefined editor configurations
 */
export const EDITOR_CONFIGS: Record<string, RichEditorConfig> = {
  /** Full-featured editor for notes */
  notes: {
    id: 'notes',
    name: 'Notes Editor',
    showToolbar: true,
    showTableOfContents: true,
    enableDragDrop: true,
    enableLinkEditing: true,
    enableContentSearch: true,
    placeholder: 'Write your notes here...'
  },

  /** Simple editor for message editing */
  message: {
    id: 'message',
    name: 'Message Editor',
    showToolbar: false,
    showTableOfContents: false,
    enableDragDrop: false,
    enableLinkEditing: true,
    enableContentSearch: false,
    placeholder: 'Edit your message...'
  },

  /** Editor for prompt editing */
  prompt: {
    id: 'prompt',
    name: 'Prompt Editor',
    showToolbar: true,
    showTableOfContents: false,
    enableDragDrop: false,
    enableLinkEditing: true,
    enableContentSearch: true,
    placeholder: 'Write your prompt...'
  },

  /** Read-only viewer */
  viewer: {
    id: 'viewer',
    name: 'Content Viewer',
    showToolbar: false,
    showTableOfContents: false,
    enableDragDrop: false,
    enableLinkEditing: false,
    enableContentSearch: true,
    readOnly: true,
    placeholder: ''
  }
}

/**
 * Create a RichEditor component with the given configuration
 */
export function createRichEditor(config: RichEditorConfig): FC<RichEditorProps> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config }

  const ConfiguredEditor: FC<RichEditorProps> = React.forwardRef<RichEditorRef, RichEditorProps>(
    (props, ref) => {
      return (
        <RichEditor
          ref={ref}
          {...props}
          showToolbar={mergedConfig.showToolbar}
          showTableOfContents={mergedConfig.showTableOfContents}
          enableDragDrop={mergedConfig.enableDragDrop}
          enableLinkEditing={mergedConfig.enableLinkEditing}
          enableContentSearch={mergedConfig.enableContentSearch}
          placeholder={mergedConfig.placeholder}
          readOnly={mergedConfig.readOnly}
          className={mergedConfig.className}
        />
      )
    }
  )

  ConfiguredEditor.displayName = `RichEditor(${mergedConfig.name})`
  return ConfiguredEditor
}

/**
 * Get a predefined editor configuration by ID
 */
export function getEditorConfig(configId: string): RichEditorConfig {
  return EDITOR_CONFIGS[configId] || DEFAULT_CONFIG
}

/**
 * Create a RichEditor with a predefined configuration
 */
export function createPresetEditor(configId: string): FC<RichEditorProps> {
  const config = getEditorConfig(configId)
  return createRichEditor(config)
}

// Export preset editors
export const NotesEditor = createPresetEditor('notes')
export const MessageEditor = createPresetEditor('message')
export const PromptEditor = createPresetEditor('prompt')
export const ContentViewer = createPresetEditor('viewer')
