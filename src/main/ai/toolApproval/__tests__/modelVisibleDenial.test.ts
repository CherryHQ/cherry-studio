import { describe, expect, it } from 'vitest'

import { modelVisibleDenial } from '../modelVisibleDenial'

describe('modelVisibleDenial', () => {
  const ignoredQuestion =
    'The user ignored this question without answering. The tool did not execute. The user is waiting for your instructions.'
  const noReason =
    'The user denied permission to use this tool. The tool did not execute. The user gave no reason and is waiting for your instructions.'

  it.each(['AskUserQuestion', 'builtin_AskUserQuestion'])('distinguishes ignored %s questions', (toolName) => {
    expect(modelVisibleDenial({ approved: false, source: 'user' }, toolName)).toBe(ignoredQuestion)
  })

  it('keeps an exact typed reason on a question', () => {
    const reason = '  Please ask me tomorrow.  '
    expect(modelVisibleDenial({ approved: false, source: 'user', reason }, 'AskUserQuestion')).toBe(
      `The user denied permission to use AskUserQuestion. The tool did not execute. The user's exact words are between these markers:\n<<<USER_WORDS>>>\n${reason}\n<<<USER_WORDS>>>`
    )
  })

  it.each([
    'Der Benutzer hat die Berechtigung für dieses Tool verweigert.',
    'Ο χρήστης αρνήθηκε την άδεια για αυτό το εργαλείο.',
    'User denied permission for this tool.',
    'El usuario denegó el permiso para esta herramienta.',
    "L'utilisateur a refusé l'autorisation pour cet outil.",
    'ユーザーはこのツールの使用を拒否しました。',
    'Utilizador negou permissão para esta ferramenta.',
    'Utilizatorul a refuzat permisiunea pentru acest instrument.',
    'Пользователь отказал в разрешении на использование этого инструмента.',
    'Kullanıcı bu araç için izni reddetti.',
    'Người dùng đã từ chối cấp quyền cho công cụ này.',
    '用户拒绝了该工具的权限。',
    '使用者拒絕了該工具的權限。',
    'User dismissed AskUserQuestion',
    'User denied tool execution'
  ])('does not quote a legacy system reason: %s', (reason) => {
    const toolName = reason === 'User dismissed AskUserQuestion' ? 'AskUserQuestion' : 'bash'
    expect(modelVisibleDenial({ approved: false, source: 'user', reason: ` ${reason} ` }, toolName)).toBe(
      toolName === 'AskUserQuestion' ? ignoredQuestion : noReason
    )
  })

  it('quotes a typed reason containing but not equalling a legacy fallback', () => {
    const reason = 'I meant User denied tool execution only for this run.'
    expect(modelVisibleDenial({ approved: false, source: 'user', reason }, 'bash')).toBe(
      `The user denied permission to use bash. The tool did not execute. The user's exact words are between these markers:\n<<<USER_WORDS>>>\n${reason}\n<<<USER_WORDS>>>`
    )
  })

  it('chooses markers absent from the exact user words', () => {
    const reason = '  "quoted"\n<<<USER_WORDS>>>\nlast  '
    expect(modelVisibleDenial({ approved: false, source: 'user', reason }, 'bash')).toBe(
      `The user denied permission to use bash. The tool did not execute. The user's exact words are between these markers:\n<<<<USER_WORDS>>>>\n${reason}\n<<<<USER_WORDS>>>>`
    )
  })

  it('does not attribute host status to the user', () => {
    expect(modelVisibleDenial({ approved: false, source: 'host', hostReason: 'service-shutdown' }, 'bash')).toBe(
      'service-shutdown'
    )
  })
})
