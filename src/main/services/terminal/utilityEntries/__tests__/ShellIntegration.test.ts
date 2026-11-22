import { expect, it } from 'vitest'

import { ShellIntegration, type ShellIntegrationEvent } from '../ShellIntegration'

it('recognizes split managed frames and Unicode without treating prompt-shaped output as completion', () => {
  const events: ShellIntegrationEvent[] = []
  const output: Uint8Array[] = []
  const integration = new ShellIntegration('token', (event) => events.push(event))
  const bytes = Buffer.from(
    `中文 $ \x1b]633;Cherry;other;1;P;0;Lw==\x07\x1b]633;Cherry;token;1;B\x07text\x1b]633;Cherry;token;2;P;7;L3RtcA==\x07`
  )
  for (const byte of bytes) integration.push(Uint8Array.of(byte), (data) => output.push(data))
  expect(Buffer.concat(output).toString()).toBe('中文 $ \x1b]633;Cherry;other;1;P;0;Lw==\x07text')
  expect(events).toEqual([
    { kind: 'program', revision: 1 },
    { kind: 'prompt', revision: 2, exitCode: 7, cwd: '/tmp' }
  ])
})

it('ignores old facts and fails closed on malformed or oversized managed frames', () => {
  const events: ShellIntegrationEvent[] = []
  const integration = new ShellIntegration('token', (event) => events.push(event))
  const send = (text: string) => integration.push(Buffer.from(text), () => {})
  send('\x1b]633;Cherry;token;4;B\x07\x1b]633;Cherry;token;3;P;0;Lw==\x07')
  send('\x1b]633;Cherry;token;5;P;invalid;Lw==\x07')
  send(`\x1b]633;Cherry;token;${'x'.repeat(17 * 1024)}`)
  expect(events).toEqual([{ kind: 'program', revision: 4 }, { kind: 'unknown' }, { kind: 'unknown' }])
})

it('records exact Unicode command metadata but cannot turn malformed or truncated metadata into runnable text', () => {
  const events: ShellIntegrationEvent[] = []
  const integration = new ShellIntegration('token', (event) => events.push(event))
  const command = 'printf "中文🙂\\n"\necho second'
  const values = [
    Buffer.from(command).toString('base64'),
    '',
    '!!!!',
    '/w==',
    Buffer.from('x'.repeat(8193)).toString('base64')
  ]
  values.forEach((value, index) => {
    const frame = Buffer.from(`\x1b]633;Cherry;token;${index + 1};B;${value}\x07`)
    for (const byte of frame) integration.push(Uint8Array.of(byte), () => {})
  })
  expect(events).toEqual([
    { kind: 'program', revision: 1, command },
    ...[2, 3, 4, 5].map((revision) => ({ kind: 'program', revision }))
  ])
})

it('fences editor readiness to an earlier prompt instead of treating it as command execution', () => {
  const events: ShellIntegrationEvent[] = []
  const integration = new ShellIntegration('token', (event) => events.push(event))
  for (const frame of ['1;P;0;Lw==', '2;R;1', '3;R;3', '4;R;0', '5;R;invalid'])
    integration.push(Buffer.from(`\x1b]633;Cherry;token;${frame}\x07`), () => {})
  expect(events).toEqual([
    { kind: 'prompt', revision: 1, exitCode: 0, cwd: '/' },
    { kind: 'ready', revision: 2, promptRevision: 1 },
    { kind: 'unknown' },
    { kind: 'unknown' },
    { kind: 'unknown' }
  ])
})
