// @vitest-environment jsdom
import { expect, it } from 'vitest'

import { summaryDocument } from './MeetingSummaryView'

it('preserves report headings, tables and styles while removing active content and credential controls', () => {
  const result = summaryDocument(
    `<html><head><style>:root{--paper:white}.report{padding:24px}</style></head><body><h1>上线范围</h1><table><tr><td>预约咨询</td></tr></table><script>alert(1)</script><iframe src="https://example.com"></iframe><form><input type="password"><button>登录</button></form><img src="https://example.com/track" onerror="alert(1)"><a href="javascript:alert(1)">摘要</a></body></html>`
  )
  expect(result.querySelector('h1')?.textContent).toBe('上线范围')
  expect(result.querySelector('td')?.textContent).toBe('预约咨询')
  expect(result.querySelector('style')?.textContent).toContain('padding:24px')
  expect(result.querySelector('style')?.textContent).toContain(':host{--paper:white}')
  expect(result.querySelector('script,iframe,form,input,button,img,a,[onerror],[href]')).toBeNull()
})
