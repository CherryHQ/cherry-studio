import { describe, expect, it } from 'vitest'

import { normalizeToolErrorResponse } from '../../toolResponse'
import { parseAutomationReplOutput } from '../automationRepl'

const failedCell = {
  isError: true,
  content: [
    { type: 'text', text: 'LISTED \nTypeError: cannot read property id of undefined' },
    { type: 'text', text: 'REPL_CONTEXT {}', annotations: { audience: ['assistant'] } }
  ]
}

describe('parseAutomationReplOutput', () => {
  it('shows the script error, not the serialized result, when a cell fails', () => {
    const result = parseAutomationReplOutput(normalizeToolErrorResponse(JSON.stringify(failedCell)))
    expect(result).toEqual({ text: 'LISTED \nTypeError: cannot read property id of undefined', isError: true })
  })

  it('unwraps a serialized content array from runtimes that forward only blocks', () => {
    const result = parseAutomationReplOutput(normalizeToolErrorResponse(JSON.stringify(failedCell.content)))
    expect(result.text).toBe('LISTED \nTypeError: cannot read property id of undefined')
  })

  it('keeps a plain error message as is', () => {
    expect(parseAutomationReplOutput(normalizeToolErrorResponse('Automation run is no longer active'))).toEqual({
      text: 'Automation run is no longer active',
      isError: true
    })
  })
})
