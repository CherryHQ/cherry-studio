import type { BasicSetupOptions, Extension } from '@uiw/react-codemirror'

export type CodeMirrorTheme = 'light' | 'dark' | 'none' | Extension

/** Language data structure for file extension mapping */
export interface LanguageData {
  type: string
  aliases?: string[]
  extensions?: string[]
}

/** Language configuration mapping language names to their data */
export type LanguageConfig = Record<string, LanguageData>

export interface CodeEditorHandles {
  save?: () => void
}

export interface CodeEditorProps {
  ref?: React.RefObject<CodeEditorHandles | null>
  /** Value used in controlled mode, e.g., code blocks. */
  value: string
  /** Placeholder when the editor content is empty. */
  placeholder?: string | HTMLElement
  /**
   * Code language string.
   * - Case-insensitive.
   * - Supports common names: javascript, json, python, etc.
   * - Supports aliases: c#/csharp, objective-c++/obj-c++/objc++, etc.
   * - Supports file extensions: .cpp/cpp, .js/js, .py/py, etc.
   */
  language: string
  /**
   * Language configuration for extension mapping.
   * If not provided, will use a default minimal configuration.
   * @optional
   */
  languageConfig?: LanguageConfig
  /** Fired when ref.save() is called or the save shortcut is triggered. */
  onSave?: (newContent: string) => void
  /** Fired when the editor content changes. */
  onChange?: (newContent: string) => void
  /** Fired when the editor loses focus. */
  onBlur?: (newContent: string) => void
  /** Fired when the editor height changes. */
  onHeightChange?: (scrollHeight: number) => void
  /**
   * Fixed editor height, not exceeding maxHeight.
   * Only works when expanded is false.
   */
  height?: string
  /**
   * Maximum editor height.
   * Only works when expanded is false.
   */
  maxHeight?: string
  /** Minimum editor height. */
  minHeight?: string
  /** Editor options that extend BasicSetupOptions. */
  options?: {
    /**
     * Whether to enable special treatment for stream response.
     * @default false
     */
    stream?: boolean
    /**
     * Whether to enable linting.
     * @default false
     */
    lint?: boolean
    /**
     * Whether to enable keymap.
     * @default false
     */
    keymap?: boolean
  } & BasicSetupOptions
  /** Additional extensions for CodeMirror. */
  extensions?: Extension[]
  /**
   * CodeMirror theme name: 'light', 'dark', 'none', Extension.
   * @default 'light'
   */
  theme?: CodeMirrorTheme
  /**
   * Font size that overrides the app setting.
   * @default 16
   */
  fontSize?: number
  /** Style overrides for the editor, passed directly to CodeMirror's style property. */
  style?: React.CSSProperties
  /** CSS class name appended to the default `code-editor` class. */
  className?: string
  /**
   * Whether the editor is editable.
   * @default true
   */
  editable?: boolean
  /**
   * Whether the editor is read only.
   * @default false
   */
  readOnly?: boolean
  /**
   * Whether the editor is expanded.
   * If true, the height and maxHeight props are ignored.
   * @default true
   */
  expanded?: boolean
  /**
   * Whether the code lines are wrapped.
   * @default true
   */
  wrapped?: boolean
}
