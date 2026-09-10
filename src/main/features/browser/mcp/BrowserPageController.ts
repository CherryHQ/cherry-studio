import type { Protocol } from 'devtools-protocol'
import type TurndownService from 'turndown'

import type { BrowserPointerFeedback } from '../BrowserCursor'
import type { GuestSession } from '../session/GuestSession'
import { logger } from './types'

export abstract class BrowserPageController {
  private turndownServicePromise?: Promise<TurndownService>

  abstract getSession(
    privateMode?: boolean,
    tabId?: string
  ): Promise<{ tabId: string; session: GuestSession; signal?: AbortSignal; pointer?: BrowserPointerFeedback }>
  abstract open(
    url: string,
    timeout?: number,
    privateMode?: boolean,
    newTab?: boolean,
    showWindow?: boolean,
    signal?: AbortSignal
  ): Promise<{ currentUrl: string; title: string; tabId: string }>
  abstract validateUrl(url: string): string

  private getTurndownService(): Promise<TurndownService> {
    return (this.turndownServicePromise ??= import('turndown').then(
      ({ default: TurndownService }) => new TurndownService()
    ))
  }

  public async execute(code: string, timeout = 5000, privateMode = false, tabId?: string, signal?: AbortSignal) {
    const { session, signal: targetSignal } = await this.getSession(privateMode, tabId)
    signal = targetSignal ? AbortSignal.any(signal ? [signal, targetSignal] : [targetSignal]) : signal
    return session.run(
      async () => {
        const result = await session.send(
          'Runtime.evaluate',
          {
            expression: code,
            awaitPromise: true,
            returnByValue: true,
            timeout
          },
          { deadline: Date.now() + timeout, signal }
        )
        if (result.exceptionDetails)
          throw new Error(result.exceptionDetails.exception?.description ?? 'Script evaluation failed')
        return result.result?.value ?? result.result?.description ?? null
      },
      { deadline: Date.now() + timeout, signal }
    )
  }

  public async fetch(
    url: string,
    format: 'html' | 'txt' | 'markdown' | 'json' = 'markdown',
    timeout = 10000,
    privateMode = false,
    newTab = false,
    showWindow = false,
    selector?: string,
    signal?: AbortSignal
  ): Promise<{ tabId: string; content: string | object }> {
    const { tabId } = await this.open(url, timeout, privateMode, newTab, showWindow, signal)

    let expression: string
    const root = selector
      ? `(document.querySelector(${JSON.stringify(selector)}) || document.body)`
      : format === 'json' || format === 'txt'
        ? 'document.body'
        : 'document.documentElement'

    if (format === 'json' || format === 'txt') {
      expression = `${root}.innerText`
    } else {
      expression = `${root}.outerHTML`
    }

    const rawContent = String((await this.execute(expression, timeout, privateMode, tabId, signal)) ?? '')

    let content: string | object
    if (format === 'markdown') {
      content = (await this.getTurndownService()).turndown(rawContent)
    } else if (format === 'json') {
      try {
        content = JSON.parse(rawContent)
      } catch (parseError) {
        logger.warn('JSON parse failed, returning raw content', {
          url,
          contentLength: rawContent.length,
          error: parseError
        })
        content = { data: rawContent }
      }
    } else {
      content = rawContent
    }

    return { tabId, content }
  }

  public async screenshot(
    options: { fullPage?: boolean; format?: 'png' | 'jpeg'; quality?: number } = {},
    privateMode = false,
    tabId?: string,
    signal?: AbortSignal
  ): Promise<string> {
    const { session, signal: targetSignal } = await this.getSession(privateMode, tabId)
    signal = targetSignal ? AbortSignal.any(signal ? [signal, targetSignal] : [targetSignal]) : signal

    const format = options.format ?? 'png'
    const params: Protocol.Page.CaptureScreenshotRequest = {
      format,
      captureBeyondViewport: options.fullPage ?? false
    }
    if (format === 'jpeg' && options.quality !== undefined) {
      params.quality = options.quality
    }

    const result = await session.run(() => session.send('Page.captureScreenshot', params, { signal }), { signal })
    return result.data
  }
}
