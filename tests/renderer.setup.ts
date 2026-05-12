import '@testing-library/jest-dom/vitest'

import { createRequire } from 'node:module'
import { styleSheetSerializer } from 'jest-styled-components/serializer'
import { expect, vi } from 'vitest'

const require = createRequire(import.meta.url)
const bufferModule = require('buffer')
if (!bufferModule.SlowBuffer) {
  bufferModule.SlowBuffer = bufferModule.Buffer
}

expect.addSnapshotSerializer(styleSheetSerializer)

// Mock LoggerService globally for renderer tests
vi.mock('@logger', async () => {
  const { MockRendererLoggerService, mockRendererLoggerService } = await import('./__mocks__/RendererLoggerService')
  return {
    LoggerService: MockRendererLoggerService,
    loggerService: mockRendererLoggerService
  }
})

// Mock PreferenceService globally for renderer tests
vi.mock('@data/PreferenceService', async () => {
  const { MockPreferenceService } = await import('./__mocks__/renderer/PreferenceService')
  return MockPreferenceService
})

// Mock DataApiService globally for renderer tests
vi.mock('@data/DataApiService', async () => {
  const { MockDataApiService } = await import('./__mocks__/renderer/DataApiService')
  return MockDataApiService
})

// Mock CacheService globally for renderer tests
vi.mock('@data/CacheService', async () => {
  const { MockCacheService } = await import('./__mocks__/renderer/CacheService')
  return MockCacheService
})

// Mock useDataApi hooks globally for renderer tests
vi.mock('@data/hooks/useDataApi', async () => {
  const { MockUseDataApi } = await import('./__mocks__/renderer/useDataApi')
  return MockUseDataApi
})

// Mock usePreference hooks globally for renderer tests
vi.mock('@data/hooks/usePreference', async () => {
  const { MockUsePreference } = await import('./__mocks__/renderer/usePreference')
  return MockUsePreference
})

// Mock useCache hooks globally for renderer tests
vi.mock('@data/hooks/useCache', async () => {
  const { MockUseCache } = await import('./__mocks__/renderer/useCache')
  return MockUseCache
})

// Mock PreferenceService globally for renderer tests
vi.mock('@data/PreferenceService', async () => {
  const { MockPreferenceService } = await import('./__mocks__/renderer/PreferenceService')
  return MockPreferenceService
})

// Mock DataApiService globally for renderer tests
vi.mock('@data/DataApiService', async () => {
  const { MockDataApiService } = await import('./__mocks__/renderer/DataApiService')
  return MockDataApiService
})

// Mock CacheService globally for renderer tests
vi.mock('@data/CacheService', async () => {
  const { MockCacheService } = await import('./__mocks__/renderer/CacheService')
  return MockCacheService
})

// Mock useDataApi hooks globally for renderer tests
vi.mock('@data/hooks/useDataApi', async () => {
  const { MockUseDataApi } = await import('./__mocks__/renderer/useDataApi')
  return MockUseDataApi
})

// Mock usePreference hooks globally for renderer tests
vi.mock('@data/hooks/usePreference', async () => {
  const { MockUsePreference } = await import('./__mocks__/renderer/usePreference')
  return MockUsePreference
})

// Mock useCache hooks globally for renderer tests
vi.mock('@data/hooks/useCache', async () => {
  const { MockUseCache } = await import('./__mocks__/renderer/useCache')
  return MockUseCache
})

// Mock uuid globally for renderer tests
let uuidCounter = 0
vi.mock('uuid', () => ({
  v4: () => 'test-uuid-' + ++uuidCounter
}))

vi.mock('@iconify/react', () => {
  const React = require('react')
  return {
    Icon: ({ icon, ...props }: { icon?: string }) =>
      React.createElement('span', { ...props, 'data-icon': icon, 'data-testid': 'iconify-icon' })
  }
})

vi.mock('axios', () => {
  const defaultAxiosMock = {
    get: vi.fn().mockResolvedValue({ data: {} }), // Mocking axios GET request
    post: vi.fn().mockResolvedValue({ data: {} }) // Mocking axios POST request
    // You can add other axios methods like put, delete etc. as needed
  }

  const isAxiosError = (error: unknown): error is { isAxiosError?: boolean } =>
    Boolean((error as { isAxiosError?: boolean } | undefined)?.isAxiosError)

  return {
    default: defaultAxiosMock,
    isAxiosError
  }
})

// Mock ResizeObserver for jsdom environment
vi.stubGlobal(
  'ResizeObserver',
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
)

vi.stubGlobal('electron', {
  ipcRenderer: {
    on: vi.fn(),
    send: vi.fn(),
    invoke: vi.fn().mockResolvedValue(undefined)
  }
})
vi.stubGlobal('api', {
  file: {
    read: vi.fn().mockResolvedValue('[]'),
    writeWithId: vi.fn().mockResolvedValue(undefined)
  }
})

// Mock @cherrystudio/ui globally for renderer tests
vi.mock('@cherrystudio/ui', () => {
  const React = require('react')
  const SelectContext = React.createContext({ value: undefined, onValueChange: undefined })
  const PopoverContext = React.createContext({ open: false, onOpenChange: undefined })
  return {
    Button: ({ children, onPress, disabled, isDisabled, startContent, ...props }) =>
      React.createElement(
        'button',
        { ...props, onClick: onPress ?? props.onClick, disabled: disabled || isDisabled },
        startContent,
        children
      ),
    Input: ({ hasError, 'aria-invalid': ariaInvalid, className, list, ...props }) =>
      React.createElement('input', {
        ...props,
        list,
        'aria-invalid': ariaInvalid,
        className: [
          className,
          hasError || ariaInvalid ? 'ant-input-status-error' : undefined,
          list && ariaInvalid ? 'ant-select-status-error' : undefined
        ]
          .filter(Boolean)
          .join(' ')
      }),
    Textarea: {
      Input: ({ hasError, 'aria-invalid': ariaInvalid, className, onValueChange, onChange, ...props }) =>
        React.createElement('textarea', {
          ...props,
          'aria-invalid': ariaInvalid,
          className: [className, hasError || ariaInvalid ? 'ant-input-status-error' : undefined]
            .filter(Boolean)
            .join(' '),
          onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => {
            onChange?.(event)
            onValueChange?.(event.target.value)
          }
        })
    },
    Accordion: ({ children, ...props }) =>
      React.createElement('div', { ...props, 'data-testid': 'accordion' }, children),
    AccordionItem: ({ children, ...props }) =>
      React.createElement('div', { ...props, 'data-testid': 'accordion-item' }, children),
    AccordionTrigger: ({ children, disabled, ...props }) =>
      React.createElement(
        'button',
        { ...props, type: 'button', disabled, 'data-testid': 'accordion-trigger' },
        children
      ),
    AccordionContent: ({ children, ...props }) =>
      React.createElement('div', { ...props, 'data-testid': 'accordion-content' }, children),
    ContextMenu: ({ children, ...props }) =>
      React.createElement('div', { ...props, 'data-testid': 'context-menu' }, children),
    ContextMenuTrigger: ({ children, ...props }) =>
      React.createElement('div', { ...props, 'data-testid': 'context-menu-trigger' }, children),
    ContextMenuContent: ({ children, ...props }) =>
      React.createElement('div', { ...props, 'data-testid': 'context-menu-content' }, children),
    ContextMenuItem: ({ children, onSelect, ...props }) =>
      React.createElement(
        'button',
        { ...props, type: 'button', onClick: onSelect, 'data-testid': 'context-menu-item' },
        children
      ),
    ContextMenuSeparator: (props) => React.createElement('div', { ...props, 'data-testid': 'context-menu-separator' }),
    ImagePreviewContextMenu: ({ actions = [], children, context, item }) =>
      React.createElement(
        'div',
        { 'data-testid': 'image-preview-context-menu' },
        children,
        actions.map((action) =>
          React.createElement(
            'button',
            {
              disabled: action.disabled,
              key: action.id,
              onClick: () => action.onSelect?.(item, context),
              type: 'button'
            },
            action.icon,
            action.label
          )
        )
      ),
    ImagePreviewDialog: ({ activeIndex = 0, items = [], labels = {}, onOpenChange, open, toolbarActions = [] }) =>
      open
        ? React.createElement(
            'div',
            { 'data-testid': 'image-preview-dialog' },
            items[activeIndex]
              ? React.createElement('img', {
                  alt: items[activeIndex].alt,
                  src: items[activeIndex].src
                })
              : null,
            toolbarActions.map((action) =>
              React.createElement(
                'button',
                {
                  disabled: action.disabled,
                  key: action.id,
                  onClick: () =>
                    action.onSelect?.(items[activeIndex], {
                      close: () => onOpenChange?.(false),
                      index: activeIndex,
                      items,
                      resetTransform: vi.fn(),
                      transform: { flipX: false, flipY: false, rotate: 0, scale: 1 }
                    }),
                  type: 'button'
                },
                action.icon,
                action.label
              )
            ),
            React.createElement(
              'button',
              { 'aria-label': labels.close, onClick: () => onOpenChange?.(false), type: 'button' },
              labels.close
            )
          )
        : null,
    ImagePreviewImage: ({ item, ...props }) =>
      React.createElement('img', { ...props, alt: item?.alt, src: item?.src, 'data-testid': 'image-preview-image' }),
    ImagePreviewToolbar: ({ actions = [], context, item, labels = {}, onClose }) =>
      React.createElement(
        'div',
        { 'data-testid': 'image-preview-toolbar' },
        actions.map((action) =>
          React.createElement(
            'button',
            {
              disabled: action.disabled,
              key: action.id,
              onClick: () => action.onSelect?.(item, context),
              type: 'button'
            },
            action.icon,
            action.label
          )
        ),
        React.createElement('button', { 'aria-label': labels.close, onClick: onClose, type: 'button' }, labels.close)
      ),
    ImagePreviewTrigger: ({ alt, item, ...props }) =>
      React.createElement('img', { ...props, alt: alt ?? item?.alt, src: item?.src }),
    Dialog: ({ children, open, ...props }) =>
      open ? React.createElement('div', { ...props, 'data-testid': 'dialog' }, children) : null,
    DialogContent: ({ children, ...props }) =>
      React.createElement('div', { ...props, 'data-testid': 'dialog-content' }, children),
    DialogHeader: ({ children, ...props }) =>
      React.createElement('div', { ...props, 'data-testid': 'dialog-header' }, children),
    DialogTitle: ({ children, ...props }) =>
      React.createElement('h2', { ...props, 'data-testid': 'dialog-title' }, children),
    DialogFooter: ({ children, ...props }) =>
      React.createElement('div', { ...props, 'data-testid': 'dialog-footer' }, children),
    Popover: ({ children, open = false, onOpenChange, ...props }) =>
      React.createElement(
        PopoverContext.Provider,
        { value: { open, onOpenChange } },
        React.createElement('div', { ...props, 'data-testid': 'popover' }, children)
      ),
    PopoverTrigger: ({ children, asChild, ...props }) => {
      const context = React.useContext(PopoverContext)
      const triggerProps = {
        ...props,
        'data-testid': 'popover-trigger',
        onClick: (event: React.MouseEvent) => {
          props.onClick?.(event)
          context.onOpenChange?.(!context.open)
        }
      }
      if (asChild && React.isValidElement(children)) {
        return React.cloneElement(children, { ...triggerProps, ...children.props })
      }
      return React.createElement('div', triggerProps, children)
    },
    PopoverContent: ({ children, align, side, sideOffset, ...props }) => {
      const context = React.useContext(PopoverContext)
      return context.open ? React.createElement('div', { ...props, 'data-testid': 'popover-content' }, children) : null
    },
    MenuList: ({ children, ...props }) =>
      React.createElement('div', { ...props, 'data-testid': 'menu-list' }, children),
    MenuItem: ({ children, icon, label, onClick, ...props }) =>
      React.createElement(
        'button',
        { ...props, type: 'button', onClick, 'data-testid': 'menu-item' },
        icon,
        label,
        children
      ),
    Select: ({ children, value, onValueChange, ...props }) => {
      return React.createElement(
        SelectContext.Provider,
        { value: { value, onValueChange } },
        React.createElement('div', { ...props, 'data-testid': 'select', 'data-value': value }, children)
      )
    },
    SelectTrigger: ({ children, ...props }) =>
      React.createElement('button', { ...props, type: 'button', 'data-testid': 'select-trigger' }, children),
    SelectValue: ({ children, placeholder, ...props }) =>
      React.createElement('span', { ...props, 'data-testid': 'select-value' }, children ?? placeholder),
    SelectContent: ({ children, ...props }) =>
      React.createElement('div', { ...props, 'data-testid': 'select-content' }, children),
    SelectItem: ({ children, value, ...props }) => {
      const context = React.useContext(SelectContext)
      return React.createElement(
        'button',
        {
          ...props,
          type: 'button',
          'data-testid': 'select-item',
          'data-value': value,
          onClick: () => context.onValueChange?.(value)
        },
        children
      )
    },
    Combobox: ({ options = [], value, onChange, onValueChange, placeholder, disabled, ...props }) =>
      React.createElement(
        'select',
        {
          ...props,
          disabled,
          value: value ?? '',
          'data-testid': 'combobox',
          onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
            onChange?.(event.target.value)
            onValueChange?.(event.target.value)
          }
        },
        React.createElement('option', { value: '' }, placeholder),
        options.map((option) =>
          React.createElement(
            'option',
            { key: option.value, value: option.value, disabled: option.disabled },
            option.label
          )
        )
      ),
    Tooltip: ({ children, title, content, mouseEnterDelay, ...props }) => {
      // Support both old (title) and new (content) API
      const tooltipText = content || title
      return React.createElement(
        'div',
        {
          ...props,
          'data-testid': 'tooltip',
          ...(tooltipText && { 'data-title': tooltipText }),
          'data-mouse-enter-delay': mouseEnterDelay
        },
        children,
        tooltipText ? React.createElement('div', { 'data-testid': 'tooltip-content' }, tooltipText) : null
      )
    },
    CircularProgress: ({ value, renderLabel, showLabel, ...props }) =>
      React.createElement(
        'div',
        { ...props, 'data-testid': 'circular-progress', 'data-value': value },
        showLabel ? (renderLabel ? renderLabel(value) : value) : null
      ),
    CustomTag: ({
      children,
      icon,
      color,
      size = 12,
      style,
      tooltip,
      closable,
      onClose,
      onClick,
      onContextMenu,
      disabled,
      inactive,
      className,
      ...props
    }) => {
      const actualColor = inactive ? '#aaaaaa' : color
      const tag = React.createElement(
        'div',
        {
          ...props,
          className,
          style: {
            padding: `${size / 3}px ${closable ? size * 1.8 : size * 0.8}px ${size / 3}px ${size * 0.8}px`,
            color: actualColor,
            backgroundColor: actualColor + '20',
            fontSize: `${size}px`,
            lineHeight: 1,
            cursor: disabled ? 'not-allowed' : onClick ? 'pointer' : 'auto',
            ...style
          },
          onClick: disabled ? undefined : onClick,
          onContextMenu: disabled ? undefined : onContextMenu
        },
        icon,
        children,
        closable
          ? React.createElement(
              'button',
              {
                type: 'button',
                onClick: (event) => {
                  event.stopPropagation()
                  onClose?.()
                }
              },
              'x'
            )
          : null
      )

      return tooltip
        ? React.createElement(
            'div',
            { 'data-testid': 'tooltip', 'data-title': tooltip },
            tag,
            React.createElement('div', { 'data-testid': 'tooltip-content' }, tooltip)
          )
        : tag
    },
    Spinner: ({ text, ...props }) => React.createElement('div', { ...props, 'data-testid': 'spinner' }, text),
    CodeEditor: ({ children, ...props }) =>
      React.createElement('div', { ...props, 'data-testid': 'code-editor' }, children),
    Flex: ({ children, ...props }) => React.createElement('div', { ...props, 'data-testid': 'flex' }, children),
    ExpandableText: ({ children, ...props }) =>
      React.createElement('div', { ...props, 'data-testid': 'expandable-text' }, children),
    // Add other commonly used UI components
    Box: ({ children, ...props }) => React.createElement('div', { ...props, 'data-testid': 'box' }, children),
    Center: ({ children, ...props }) => React.createElement('div', { ...props, 'data-testid': 'center' }, children),
    ColFlex: ({ children, ...props }) => React.createElement('div', { ...props, 'data-testid': 'col-flex' }, children),
    RowFlex: ({ children, ...props }) => React.createElement('div', { ...props, 'data-testid': 'row-flex' }, children),
    SpaceBetweenRowFlex: ({ children, ...props }) =>
      React.createElement('div', { ...props, 'data-testid': 'space-between-row-flex' }, children),
    Ellipsis: ({ children, ...props }) => React.createElement('div', { ...props, 'data-testid': 'ellipsis' }, children),
    TextBadge: ({ children, ...props }) =>
      React.createElement('div', { ...props, 'data-testid': 'text-badge' }, children),
    Badge: ({ children, ...props }) => React.createElement('span', { ...props, 'data-testid': 'badge' }, children),
    Alert: ({ children, message, description, type, ...props }) =>
      React.createElement(
        'div',
        { ...props, role: 'alert', 'data-testid': 'alert', 'data-type': type },
        message,
        description,
        children
      ),
    EditableNumber: ({ value, onChange, disabled, ...props }) =>
      React.createElement('input', {
        ...props,
        type: 'number',
        value: value ?? '',
        disabled,
        'data-testid': 'editable-number',
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onChange?.(event.target.value === '' ? null : event.target.valueAsNumber)
      }),
    Skeleton: ({ children, ...props }) => React.createElement('div', { ...props, 'data-testid': 'skeleton' }, children),
    HelpTooltip: ({ children, ...props }) =>
      React.createElement('div', { ...props, 'data-testid': 'help-tooltip' }, children),
    InfoTooltip: ({ children, ...props }) =>
      React.createElement('div', { ...props, 'data-testid': 'info-tooltip' }, children),
    Scrollbar: ({ children, ...props }) =>
      React.createElement('div', { ...props, 'data-testid': 'scrollbar' }, children),
    Avatar: ({ children, src, ...props }) =>
      React.createElement('div', { ...props, 'data-testid': 'avatar' }, src ? null : children),
    EmojiAvatar: ({ children, ...props }) =>
      React.createElement('div', { ...props, 'data-testid': 'emoji-avatar' }, children),
    Switch: ({ isSelected, onValueChange, ...props }) =>
      React.createElement('input', {
        ...props,
        type: 'checkbox',
        checked: isSelected,
        onChange: (e) => onValueChange?.(e.target.checked),
        'data-testid': 'switch'
      }),
    // Popover primitives — Radix-style trigger / content split
    Popover: ({ children, ...props }) => React.createElement('div', { ...props, 'data-testid': 'popover' }, children),
    PopoverTrigger: ({ children, ...props }) =>
      React.createElement('div', { ...props, 'data-testid': 'popover-trigger' }, children),
    PopoverContent: ({ children, ...props }) =>
      React.createElement('div', { ...props, 'data-testid': 'popover-content' }, children),
    Skeleton: ({ children, ...props }) => React.createElement('div', { ...props, 'data-testid': 'skeleton' }, children),
    // Icon registry stubs
    PROVIDER_ICON_CATALOG: {},
    MODEL_ICON_CATALOG: {},
    resolveProviderIcon: () => undefined,
    resolveModelIcon: () => undefined,
    resolveModelToProviderIcon: () => undefined,
    resolveIcon: () => undefined
  }
})

if (typeof globalThis.localStorage === 'undefined' || typeof (globalThis.localStorage as any).getItem !== 'function') {
  let store = new Map<string, string>()

  const localStorageMock = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size
    }
  }

  vi.stubGlobal('localStorage', localStorageMock)
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', { value: localStorageMock })
  }
}
