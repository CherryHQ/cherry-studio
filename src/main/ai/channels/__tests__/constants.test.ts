import { describe, expect, it } from 'vitest'

import { parseSlashCommand } from '../constants'

describe('channel slash command parsing', () => {
  it.each([
    ['/new', 'new'],
    ['/compact more context', 'compact'],
    ['/help\tcommands', 'help'],
    ['/whoami\nnext line', 'whoami']
  ])('recognizes the complete command token in %s', (text, command) => {
    expect(parseSlashCommand(text)).toBe(command)
  })

  it.each(['/new-other', '/help!', '/whoami/extra', '/compact中', '/NEW', ' /new', 'ordinary message', ''])(
    'leaves %s as ordinary text',
    (text) => {
      expect(parseSlashCommand(text)).toBeUndefined()
    }
  )
})
