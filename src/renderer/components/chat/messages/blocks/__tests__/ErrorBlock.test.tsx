import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MessageListActions, MessageListItem } from '../../types'

const mocks = vi.hoisted(() => ({
  actions: {} as MessageListActions,
  i18nKeys: new Set<string>()
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  )
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: (_key: string, callback: () => void | Promise<void>) => {
      void callback()
    }
  })
}))

vi.mock('@renderer/i18n/label', () => ({
  getHttpMessageLabelKey: (status: string) => `HTTP ${status}`,
  getProviderLabelKey: (providerId: string) => providerId
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>
}))

vi.mock('react-i18next', () => ({
  Trans: ({ i18nKey }: { i18nKey: string }) => <>{i18nKey}</>,
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: 'en',
      exists: (key: string) => mocks.i18nKeys.has(key)
    }
  })
}))

vi.mock('../../MessageListProvider', () => ({
  useMessageListActions: () => mocks.actions
}))

import ErrorBlock from '../ErrorBlock'

const message: MessageListItem = {
  id: 'message-1',
  role: 'assistant',
  topicId: 'topic-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  status: 'success',
  model: {
    id: 'gpt-test',
    name: 'GPT Test',
    provider: 'openai'
  }
}

describe('ErrorBlock', () => {
  beforeEach(() => {
    mocks.actions = {}
    mocks.i18nKeys.clear()
    vi.clearAllMocks()
  })

  it.each([
    ['tool call limit', 'tool_call_limit_reached'],
    ['missing web search API host', 'web_search_api_host_missing'],
    ['invalid web search API host', 'web_search_api_host_invalid'],
    ['missing web search API key', 'web_search_api_key_missing'],
    ['unavailable web search provider', 'web_search_provider_unavailable']
  ])('renders a known app-owned i18nKey for %s without AI diagnosis', (_scenario, i18nKey) => {
    const diagnoseMessageError = vi.fn().mockResolvedValue('AI summary')
    mocks.actions = { diagnoseMessageError }
    mocks.i18nKeys.add(`error.${i18nKey}`)

    render(
      <ErrorBlock
        partId="message-1-part-0"
        error={{
          name: 'ToolLoopTerminalError',
          message: 'fallback message',
          stack: null,
          i18nKey
        }}
        message={message}
      />
    )

    expect(screen.getByText(`error.${i18nKey}`)).toBeInTheDocument()
    expect(diagnoseMessageError).not.toHaveBeenCalled()
  })

  it('hides mutation and detail affordances when capabilities are unavailable', () => {
    render(
      <ErrorBlock partId="message-1-part-0" error={{ name: 'Error', message: 'boom', stack: null }} message={message} />
    )

    expect(screen.queryByLabelText('close')).toBeNull()
    expect(screen.queryByText('common.detail')).toBeNull()
  })

  it('uses structured provider data when classifying an error', () => {
    render(
      <ErrorBlock
        partId="message-1-part-0"
        error={{
          name: 'APICallError',
          message: 'Rate limit exceeded',
          stack: null,
          statusCode: 429,
          responseBody: '{"error":{"type":"insufficient_quota"}}'
        }}
        message={message}
      />
    )

    expect(screen.getByText('error.diagnosis.quota')).toBeInTheDocument()
    expect(screen.queryByText('error.diagnosis.rate_limit')).toBeNull()
  })

  it('ignores non-serializable provider data when classifying an error', () => {
    const circularData: Record<string, unknown> = {}
    circularData.self = circularData

    render(
      <ErrorBlock
        partId="message-1-part-0"
        error={{
          name: 'APICallError',
          message: 'Rate limit exceeded',
          stack: null,
          statusCode: 429,
          data: circularData as never
        }}
        message={message}
      />
    )

    expect(screen.getByText('error.diagnosis.rate_limit')).toBeInTheDocument()
  })

  it('routes error actions through provider capabilities', async () => {
    const openErrorDetail = vi.fn()
    const removeMessageErrorPart = vi.fn().mockResolvedValue(undefined)
    const navigateErrorTarget = vi.fn()
    mocks.actions = {
      openErrorDetail,
      removeMessageErrorPart,
      navigateErrorTarget
    }

    const { container } = render(
      <ErrorBlock
        partId="message-1-part-0"
        error={{ name: 'AuthError', message: 'Unauthorized', stack: null, status: 401, providerId: 'openai' }}
        message={message}
      />
    )

    fireEvent.click(container.firstElementChild as Element)
    expect(openErrorDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        message,
        partId: 'message-1-part-0',
        error: expect.objectContaining({ message: 'Unauthorized' })
      })
    )

    fireEvent.click(screen.getByLabelText('close'))
    await waitFor(() =>
      expect(removeMessageErrorPart).toHaveBeenCalledWith({
        messageId: 'message-1',
        partId: 'message-1-part-0'
      })
    )

    fireEvent.click(screen.getByText('error.diagnosis.go_to_settings'))
    expect(navigateErrorTarget).toHaveBeenCalledWith('/settings/provider?id=openai')
  })

  it('uses injected diagnosis capability for unknown errors', async () => {
    const diagnoseMessageError = vi.fn().mockResolvedValue('AI summary')
    mocks.actions = {
      diagnoseMessageError
    }

    render(
      <ErrorBlock
        partId="message-1-part-0"
        error={{
          name: 'UnknownError',
          message: 'unmapped provider failure',
          stack: null,
          i18nKey: 'missing_app_error'
        }}
        message={message}
      />
    )

    expect(await screen.findByText('AI summary')).toBeInTheDocument()
    expect(diagnoseMessageError).toHaveBeenCalledWith(
      expect.objectContaining({
        message,
        partId: 'message-1-part-0',
        language: 'en'
      })
    )
  })
})
