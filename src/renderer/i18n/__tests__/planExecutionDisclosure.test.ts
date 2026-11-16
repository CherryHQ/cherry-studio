import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import enUs from '@renderer/i18n/locales/en-us.json'
import zhCn from '@renderer/i18n/locales/zh-cn.json'

/**
 * The plan-approval handoff writes the session's own model override (`AgentChat` →
 * `useUpdateSession().updateSession`), so the approval card
 * (`agent.toolPermission.executionModel.notice`) and the Settings row
 * (`settings.models.plan_execution_model.description`) are the surfaces that disclose what the
 * choice does. Upstream #20826 scoped model selection to the session: the copy must name the
 * session and its later turns, and must not promise other sessions an override cannot reach.
 *
 * Catalog-content contract test (miniAppPermission.test.ts pattern): the two hand-maintained
 * catalogs are asserted on their real content, so dropping a scope from the copy fails here
 * instead of shipping silently. All other locales only need the keys to exist.
 */
const NOTICE_KEY = 'agent.toolPermission.executionModel.notice'
const DESCRIPTION_KEY = 'settings.models.plan_execution_model.description'

const catalogs: Record<string, Record<string, string>> = { 'en-us': enUs, 'zh-cn': zhCn }

const locales = readdirSync(resolve('src/renderer/i18n/locales'))
  .filter((name) => name.endsWith('.json'))
  .map((name) => JSON.parse(readFileSync(join('src/renderer/i18n/locales', name), 'utf8')) as Record<string, string>)

describe('plan-execution persistence disclosure', () => {
  it('discloses the full persistent scope in the hand-maintained catalogs', () => {
    // "later turn" / "this session" (and their zh counterparts) are the two halves of the scope:
    // a copy that names neither hides that the override outlives the approved turn.
    const expectations: Array<[string, RegExp]> = [
      ['en-us', /later turns/i],
      ['en-us', /this session/i],
      ['zh-cn', /后续回合/],
      ['zh-cn', /本会话/]
    ]
    for (const key of [NOTICE_KEY, DESCRIPTION_KEY]) {
      for (const [locale, pattern] of expectations) {
        const text = catalogs[locale][key] ?? ''
        expect(text, `${locale} ${key} must exist`).not.toBe('')
        expect(pattern.test(text), `${locale} ${key} must disclose the scope reaches ${pattern} — got: "${text}"`).toBe(
          true
        )
      }
    }
  })

  it('has the disclosure keys present in every locale catalog', () => {
    const missing: string[] = []
    for (const catalog of locales) {
      for (const key of [NOTICE_KEY, DESCRIPTION_KEY]) {
        if (!catalog[key]) missing.push(key)
      }
    }
    expect(missing).toEqual([])
  })
})
