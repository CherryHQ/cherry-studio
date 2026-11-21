import { describe, expect, it } from 'vitest'

import { decodeText, encodeText, importMeeting, meetingMarkdown, parseMindMap } from './meeting'

describe('meeting documents', () => {
  it('preserves Chinese speakers and SRT timestamps through export and import', () => {
    const text = '1\n00:00:01,000 --> 00:00:03,000\n王丽：下周交付。'
    const original = { ...importMeeting('项目会议.srt', text), summary: '# 总结\n下周交付。', taskId: 'server-task' }
    const imported = importMeeting('meeting.json', decodeText(encodeText(JSON.stringify(original))))
    expect(imported.text).toBe(text)
    expect(imported.title).toBe('项目会议')
    expect(imported.summary).toBe(original.summary)
    expect(imported.id).not.toBe(original.id)
    expect(imported.taskId).toBeUndefined()
    expect(meetingMarkdown(imported)).toContain('王丽：下周交付。')
  })
  it('rejects empty transcripts and oversized multi-byte input', () => {
    expect(() => importMeeting('empty.txt', '  ')).toThrow()
    expect(() => importMeeting('large.txt', '会'.repeat(200_000))).toThrow()
  })
  it('rejects malformed mind maps from imported documents', () => {
    expect(() => parseMindMap([{ Title: 'Topic', Topic: 'not a list' }])).toThrow()
  })
})
