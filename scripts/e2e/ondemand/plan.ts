import { readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'

import * as z from 'zod'

import { isPathInside } from '../regression/paths'

export const safeName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/)
const text = z.string().min(1)
const timeout = z.number().int().positive().max(2_147_483_647).optional()
const role = z.enum([
  'alert',
  'alertdialog',
  'application',
  'article',
  'banner',
  'blockquote',
  'button',
  'caption',
  'cell',
  'checkbox',
  'code',
  'columnheader',
  'combobox',
  'complementary',
  'contentinfo',
  'definition',
  'deletion',
  'dialog',
  'directory',
  'document',
  'emphasis',
  'feed',
  'figure',
  'form',
  'generic',
  'grid',
  'gridcell',
  'group',
  'heading',
  'img',
  'insertion',
  'link',
  'list',
  'listbox',
  'listitem',
  'log',
  'main',
  'marquee',
  'math',
  'meter',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'navigation',
  'none',
  'note',
  'option',
  'paragraph',
  'presentation',
  'progressbar',
  'radio',
  'radiogroup',
  'region',
  'row',
  'rowgroup',
  'rowheader',
  'scrollbar',
  'search',
  'searchbox',
  'separator',
  'slider',
  'spinbutton',
  'status',
  'strong',
  'subscript',
  'superscript',
  'switch',
  'tab',
  'table',
  'tablist',
  'tabpanel',
  'term',
  'textbox',
  'time',
  'timer',
  'toolbar',
  'tooltip',
  'tree',
  'treegrid',
  'treeitem'
])
export const stepSchema = z.discriminatedUnion('verb', [
  z.strictObject({ verb: z.literal('click'), text }),
  z.strictObject({ verb: z.literal('clickRole'), role, name: text }),
  z.strictObject({ verb: z.literal('fill'), selector: text, text: z.string() }),
  z.strictObject({ verb: z.literal('key'), key: text }),
  z.strictObject({ verb: z.literal('waitFor'), selector: text, timeout }),
  z.strictObject({ verb: z.literal('expectText'), text, timeout }),
  z.strictObject({ verb: z.literal('expectVisible'), selector: text, timeout }),
  z.strictObject({ verb: z.literal('screenshot'), name: safeName.optional() }),
  z.strictObject({ verb: z.literal('sleep'), ms: z.number().int().nonnegative().max(2_147_483_647).default(1000) })
])
export const planSchema = z.strictObject({
  steps: z.array(stepSchema).min(1),
  continueOnFailure: z.boolean().default(false),
  requiredTimezone: text
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value })
        return true
      } catch {
        return false
      }
    }, 'requiredTimezone must be an IANA timezone')
    .optional()
})
export type Step = z.infer<typeof stepSchema>
export type Plan = z.infer<typeof planSchema>

export function parsePlan(json: string): Plan {
  if (Buffer.byteLength(json, 'utf8') > 10_240)
    throw new Error('plan exceeds 10,240 UTF-8 bytes; use a reviewed named spec')
  return planSchema.parse(JSON.parse(json))
}

export function scenarioPath(name: string): string {
  safeName.parse(name)
  const root = realpathSync(resolve(__dirname, '../../../tests/e2e/ondemand/specs'))
  const file = realpathSync(join(root, `${name}.ts`))
  if (!isPathInside(root, file)) throw new Error('Spec must be inside the reviewed specs directory')
  return file
}

export function readRequest(env: NodeJS.ProcessEnv = process.env) {
  const platform = z.enum(['windows', 'macos']).parse(env.QA_PLATFORM ?? 'windows')
  const mode = z.enum(['branch', 'tag']).parse(env.QA_MODE ?? 'branch')
  const profile = z.enum(['clean', 'authenticated']).parse(env.QA_PROFILE ?? 'clean')
  const spec = safeName.parse(env.QA_SPEC ?? 'smoke')
  const minutes = env.QA_TIMEOUT_MINUTES ?? '45'
  if (!/^\d+$/.test(minutes)) throw new Error('timeout_minutes must be an integer')
  const timeoutMinutes = Number(minutes)
  if (timeoutMinutes < (mode === 'branch' ? 15 : 1) || timeoutMinutes > 360) {
    throw new Error(
      mode === 'branch'
        ? 'branch timeout must be 15–360 minutes because dependency/build preparation has fixed costs'
        : 'tag timeout must be 1–360 minutes'
    )
  }
  const plan = env.QA_PLAN?.trim()
    ? parsePlan(env.QA_PLAN)
    : spec === 'smoke'
      ? parsePlan(readFileSync(resolve(__dirname, '../../../tests/e2e/ondemand/plans/smoke.json'), 'utf8'))
      : null
  const file = plan ? null : scenarioPath(spec)
  return { platform, mode, profile, spec, timeoutMinutes, plan, file, ref: text.parse(env.QA_REF ?? 'main') }
}
export type Request = ReturnType<typeof readRequest>
