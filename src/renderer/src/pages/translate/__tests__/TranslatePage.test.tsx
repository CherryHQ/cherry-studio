import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cacheMock = vi.hoisted(() => {
  const defaults = {
    'translate.translating': { isTranslating: false, abortKey: null },
    'translate.input': '',
    'translate.output': '',
    'translate.detecting': false
  }
  const store = new Map<string, unknown>()

  return {
    defaults,
    store,
    reset: () => {
      store.clear()
      Object.entries(defaults).forEach(([key, value]) => store.set(key, value))
    }
  }
})

const fileMock = vi.hoisted(() => ({
  onSelectFile: vi.fn(),
  readText: vi.fn(),
  isTextFile: vi.fn()
}))

vi.mock('@data/hooks/useCache', async () => {
  const React = await import('react')
  return {
    useCache: (key: keyof typeof cacheMock.defaults) => {
      const [value, setValue] = React.useState<unknown>(() => cacheMock.store.get(key) ?? cacheMock.defaults[key])
      const setter = (next: unknown) => {
        if (typeof next === 'function') {
          throw new Error('useCache mock only accepts direct values')
        }
        cacheMock.store.set(key, next)
        setValue(next)
      }
      return [value, setter]
    }
  }
})

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    const values: Record<string, unknown> = {
      'feature.translate.model_id': null,
      'feature.translate.page.source_language': 'auto',
      'feature.translate.page.target_language': 'en',
      'feature.translate.model_prompt': '',
      'feature.translate.page.auto_copy': false,
      'feature.translate.page.bidirectional_pair': ['en', 'zh'],
      'feature.translate.page.scroll_sync': false,
      'feature.translate.page.bidirectional_enabled': false,
      'feature.translate.page.enable_markdown': false
    }
    return [values[key], vi.fn()]
  }
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', () => ({
  Avatar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AvatarFallback: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button type="button" {...props}>
      {children}
    </button>
  )
}))

vi.mock('@cherrystudio/ui/icons', () => ({
  resolveIcon: () => undefined
}))

vi.mock('@renderer/components/app/Navbar', () => ({
  Navbar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  NavbarCenter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: ({ trigger }: { trigger: React.ReactNode }) => <>{trigger}</>
}))

vi.mock('@renderer/context/CodeStyleProvider', () => ({
  useCodeStyle: () => ({
    shikiMarkdownIt: vi.fn().mockResolvedValue('')
  })
}))

vi.mock('@renderer/hooks/translate', () => ({
  useTranslateHistory: () => ({ add: vi.fn() })
}))

vi.mock('@renderer/hooks/translate/useDetectLang', () => ({
  useDetectLang: () => vi.fn()
}))

vi.mock('@renderer/hooks/useDrag', () => ({
  useDrag: () => ({
    isDragging: false,
    handleDragEnter: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDragOver: vi.fn(),
    handleDrop: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useFiles', () => ({
  useFiles: () => ({
    onSelectFile: fileMock.onSelectFile,
    selecting: false,
    clearFiles: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useModels', () => ({
  useModels: () => ({ models: [] })
}))

vi.mock('@renderer/hooks/useOcr', () => ({
  useOcr: () => ({ ocr: vi.fn() })
}))

vi.mock('@renderer/hooks/useTemporaryValue', () => ({
  useTemporaryValue: () => [false, vi.fn()]
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: vi.fn() })
}))

vi.mock('@renderer/services/TokenService', () => ({
  estimateTextTokens: () => 0
}))

vi.mock('@renderer/services/TranslateService', () => ({
  translateText: vi.fn()
}))

vi.mock('@renderer/utils', () => ({
  getFileExtension: () => 'txt',
  isTextFile: fileMock.isTextFile,
  uuid: () => 'abort-key'
}))

vi.mock('@renderer/utils/abortController', () => ({
  abortCompletion: vi.fn()
}))

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: (_error: unknown, prefix: string) => prefix,
  isAbortError: () => false
}))

vi.mock('@renderer/utils/input', () => ({
  getFilesFromDropEvent: vi.fn().mockResolvedValue(null),
  getTextFromDropEvent: vi.fn().mockResolvedValue(null)
}))

vi.mock('@renderer/utils/translate', () => ({
  createInputScrollHandler: () => vi.fn(),
  createOutputScrollHandler: () => vi.fn(),
  determineTargetLanguage: () => ({ success: true, language: 'en' }),
  UNKNOWN_LANG_CODE: 'unknown'
}))

vi.mock('../components/IconButton', () => ({
  default: (props: React.ComponentProps<'button'> & { active?: boolean; size?: string }) => {
    const { active, children, size, ...buttonProps } = props
    void active
    void size
    return (
      <button type="button" {...buttonProps}>
        {children}
      </button>
    )
  }
}))

vi.mock('../components/TranslateHistory', () => ({
  default: () => null
}))

vi.mock('../components/TranslateInputPane', () => ({
  default: ({
    text,
    onTextChange,
    onSelectFile
  }: {
    text: string
    onTextChange: (value: string) => void
    onSelectFile: () => void
  }) => (
    <div>
      <textarea
        aria-label="translate.input.placeholder"
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
      />
      <button type="button" aria-label="common.upload_files" onClick={onSelectFile} />
    </div>
  )
}))

vi.mock('../components/TranslateLanguageBar', () => ({
  default: () => null
}))

vi.mock('../components/TranslateOutputPane', () => ({
  default: () => null
}))

vi.mock('../TranslateSettings', () => ({
  default: () => null
}))

import TranslatePage from '../TranslatePage'

describe('TranslatePage', () => {
  beforeEach(() => {
    cacheMock.reset()
    fileMock.onSelectFile.mockReset()
    fileMock.readText.mockReset()
    fileMock.isTextFile.mockResolvedValue(true)
    ;(window as any).toast = {
      error: vi.fn(),
      info: vi.fn(),
      loading: vi.fn(),
      success: vi.fn(),
      warning: vi.fn()
    }
    ;(window as any).api = {
      file: {
        readExternal: vi.fn()
      },
      fs: {
        readText: fileMock.readText
      }
    }
  })

  afterEach(() => {
    cleanup()
  })

  it('appends selected file text to the latest input after async read completes', async () => {
    let resolveRead: (value: string) => void = () => {}
    fileMock.onSelectFile.mockResolvedValue([{ path: '/tmp/input.txt', size: 10 }])
    fileMock.readText.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveRead = resolve
      })
    )

    render(<TranslatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'common.upload_files' }))
    await waitFor(() => expect(fileMock.readText).toHaveBeenCalledWith('/tmp/input.txt'))

    fireEvent.change(screen.getByLabelText('translate.input.placeholder'), {
      target: { value: 'typed while reading ' }
    })

    await act(async () => {
      resolveRead('file content')
    })

    await waitFor(() => {
      expect(screen.getByLabelText('translate.input.placeholder')).toHaveValue('typed while reading file content')
    })
  })
})
