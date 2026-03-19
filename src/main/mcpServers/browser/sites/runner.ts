import { readFileSync } from 'node:fs'

import type { CdpBrowserController } from '../controller'
import type { SiteMeta } from '../types'
import { logger } from '../types'

const AUTH_ERROR_RE =
  /401|403|unauthorized|forbidden|not.?logged|login.?required|sign.?in|auth.?(?:failed|expired|required|error|token)/i

type RunResult = {
  success: boolean
  data?: unknown
  error?: string
  hint?: string
}

/**
 * Check whether a tab URL's hostname matches the adapter domain.
 * `x.com` matches `https://x.com/home`; `api.twitter.com` matches domain `twitter.com`.
 */
export function domainMatches(tabUrl: string, domain: string): boolean {
  try {
    const hostname = new URL(tabUrl).hostname
    return hostname === domain || hostname.endsWith('.' + domain)
  } catch {
    return false
  }
}

/**
 * Run a site adapter in the browser via the CDP controller.
 *
 * Steps:
 * 1. Validate required args
 * 2. Read adapter JS file and strip @meta block
 * 3. Resolve domain tab (reuse existing or open new)
 * 4. Build IIFE and execute via controller
 * 5. Parse result and detect auth errors
 */
export async function runSiteAdapter(
  controller: CdpBrowserController,
  site: SiteMeta,
  args: Record<string, string>,
  options?: { timeout?: number; privateMode?: boolean; showWindow?: boolean }
): Promise<RunResult> {
  const timeout = options?.timeout ?? 30_000
  const privateMode = options?.privateMode ?? false
  const showWindow = options?.showWindow ?? false

  // 1. Validate required args
  const missing: string[] = []
  for (const [name, def] of Object.entries(site.args)) {
    if (def.required && !(name in args)) {
      missing.push(name)
    }
  }
  if (missing.length > 0) {
    const usage = Object.entries(site.args)
      .map(([name, def]) => `  ${name}${def.required ? ' (required)' : ''}: ${def.description || 'no description'}`)
      .join('\n')
    return {
      success: false,
      error: `Missing required args: ${missing.join(', ')}`,
      hint: `Usage for ${site.name}:\n${usage}${site.example ? `\nExample: ${site.example}` : ''}`
    }
  }

  // 2. Read adapter file and strip @meta block
  let content: string
  try {
    content = readFileSync(site.filePath, 'utf-8')
  } catch (error) {
    logger.error('Failed to read adapter file', { filePath: site.filePath, error })
    return { success: false, error: `Failed to read adapter file: ${site.filePath}` }
  }

  const jsBody = content.replace(/\/\*\s*@meta[\s\S]*?\*\//, '').trim()

  // 3. Domain tab resolution
  let tabId: string | undefined

  if (site.domain) {
    const tabs = await controller.listTabs(privateMode)
    const existing = tabs.find((t) => domainMatches(t.url, site.domain))

    if (existing) {
      tabId = existing.tabId
      logger.info('Reusing existing tab for domain', { domain: site.domain, tabId })
    } else {
      const opened = await controller.open(`https://${site.domain}`, timeout, privateMode, true, showWindow)
      tabId = opened.tabId
      logger.info('Opened new tab for domain', { domain: site.domain, tabId })
    }
  } else {
    // No domain — check if there is an active tab
    const tabs = await controller.listTabs(privateMode)
    if (tabs.length === 0) {
      return {
        success: false,
        error: 'No page open. Use an adapter with a domain or open a page first.'
      }
    }
    // Use active tab (don't pass tabId — controller.execute uses active tab)
  }

  // 4. Build IIFE and execute
  const script = `(${jsBody})(${JSON.stringify(args)})`

  let rawResult: unknown
  try {
    rawResult = await controller.execute(script, timeout, privateMode, tabId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Adapter execution failed', { name: site.name, error: message })
    return { success: false, error: message }
  }

  // 5. Parse result
  let data: unknown = rawResult
  if (typeof rawResult === 'string') {
    try {
      data = JSON.parse(rawResult)
    } catch {
      // Not JSON — pass through as string
    }
  }

  // 6. Error detection
  if (data && typeof data === 'object' && 'error' in data) {
    const errorObj = data as { error: string; hint?: string }
    const errorMsg = String(errorObj.error)

    let hint = errorObj.hint
    if (AUTH_ERROR_RE.test(errorMsg)) {
      hint = `Please log in to https://${site.domain || 'the site'} in the browser first.${hint ? ' ' + hint : ''}`
    }

    return { success: false, error: errorMsg, hint }
  }

  return { success: true, data }
}
