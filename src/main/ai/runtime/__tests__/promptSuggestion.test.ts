import { expect, it } from 'vitest'

import { normalizePromptSuggestion } from '../promptSuggestion'

it.each([
  ['<suggestion>run the tests</suggestion>', 'run the tests'],
  ['Suggested prompt: run the tests', 'run the tests'],
  ['建议：运行测试', '运行测试'],
  ['yes', 'yes'],
  ['提交', '提交'],
  ['测', ''],
  ['thanks', ''],
  ['looks good', ''],
  ['让我运行测试', ''],
  ["I'll run tests", ''],
  ['No suggestion available', ''],
  ['(run the tests)', ''],
  ['API error: unavailable', ''],
  ['First task. Second task', ''],
  ['运行测试。提交代码', ''],
  ['**run tests**', ''],
  ['a b c d e f g h i j k l m', ''],
  ['测'.repeat(24), '测'.repeat(24)],
  ['测'.repeat(25), ''],
  ['x'.repeat(95) + ' abc', 'x'.repeat(95) + ' abc'],
  ['x'.repeat(96) + ' abc', '']
])('cleans and validates a CLI candidate: %s', (candidate, expected) => {
  expect(normalizePromptSuggestion(candidate)).toBe(expected)
})
