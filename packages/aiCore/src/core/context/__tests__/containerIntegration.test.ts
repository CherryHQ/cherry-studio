import { it, expect } from 'vitest'

import { summarizeHistory } from '../janitor'
import { ContextPrompts } from '../prompts'
import {
  stripKnownModelScratchpadBlocksPreservingCodeFences as strip,
  stripKnownModelScratchpadBlocksPreservingCodeFencesStepped as stepped
} from '../scratchpadText'
import quoteCases from './r24QuoteOwnership.json'
it('formatter and janitor fence ownership', async () => {
  for (const raw of [
    '- \n  -\n\n    <thinking>SECRET</thinking>\n',
    '- ```\n  ```\n    <analysis>SECRET</analysis>\n',
    '- ```\n    ```\n\n    <analysis>SECRET</analysis>\n'
  ]) {
    const out = ContextPrompts.formatCompactSummary(raw)
    console.log('FMT', JSON.stringify({ raw, out }))
    expect(out).not.toContain('SECRET')
    expect(await summarizeHistory([{ role: 'user', content: 'hello' }], async () => raw)).not.toContain('SECRET')
  }
})

it('quoted bare list marker privacy and literal code', async () => {
  for (const { raw, code } of quoteCases) {
    expect(strip(raw).includes('MARK'), JSON.stringify({ raw, code })).toBe(code)
    expect(stepped(raw)).toBe(strip(raw))
    expect(ContextPrompts.formatCompactSummary(raw).includes('MARK'), JSON.stringify({ raw, code })).toBe(code)
    expect((await summarizeHistory([{ role: 'user', content: 'hello' }], async () => raw)).includes('MARK')).toBe(code)
  }
})

import disputed from './containerEvents/disputed-cases.json'
import agreed from './containerEvents/dual-oracle-cases.json'
import transitions from './containerEvents/transition84.json'
it('shared event integration dual oracle and explicit CommonMark compatibility', async () => {
  for (const { raw, commonmark } of [...agreed, ...disputed]) {
    expect(strip(raw).includes('MARK'), JSON.stringify({ raw, commonmark })).toBe(commonmark)
    expect(stepped(raw)).toBe(strip(raw))
    expect(ContextPrompts.formatCompactSummary(raw).includes('MARK'), JSON.stringify({ raw, commonmark })).toBe(
      commonmark
    )
  }
})
it('shared event integration review84', () => {
  for (const { raw, want } of transitions) expect(strip(raw).includes('MARK'), JSON.stringify({ raw, want })).toBe(want)
})
