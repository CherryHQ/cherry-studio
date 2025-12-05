import '@testing-library/jest-dom/vitest'

import { styleSheetSerializer } from 'jest-styled-components/serializer'
import { expect, vi } from 'vitest'

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

vi.stubGlobal('electron', {
  ipcRenderer: {
    on: vi.fn(),
    send: vi.fn()
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
  return {
    Button: ({ children, onPress, disabled, isDisabled, startContent, ...props }) =>
      React.createElement(
        'button',
        { ...props, onClick: onPress, disabled: disabled || isDisabled },
        startContent,
        children
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
      })
    // Add any other components that are commonly imported
  }
})
