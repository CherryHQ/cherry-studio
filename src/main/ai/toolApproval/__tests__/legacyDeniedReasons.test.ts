import { describe, expect, it } from 'vitest'

import { isLegacySystemDenialReason } from '../legacyDeniedReasons'

describe('isLegacySystemDenialReason', () => {
  const historicalReasons = [
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
  ]

  it('recognizes the 15 historical UI reasons, including all locales and both English fallbacks', () => {
    expect(historicalReasons).toHaveLength(15)
    for (const reason of historicalReasons) expect(isLegacySystemDenialReason(reason)).toBe(true)
  })

  it('trims only surrounding whitespace before exact comparison', () => {
    expect(isLegacySystemDenialReason(' \nUser denied tool execution\t ')).toBe(true)
    expect(isLegacySystemDenialReason('User  denied tool execution')).toBe(false)
  })

  it.each([
    'I meant User denied tool execution only for this run.',
    'User denied tool execution because I said so.',
    'User dismissed AskUserQuestion later'
  ])('does not treat containing text as a historical UI reason: %s', (reason) => {
    expect(isLegacySystemDenialReason(reason)).toBe(false)
  })

  it.each(['user denied tool execution', 'USER DENIED TOOL EXECUTION'])('does not fold case: %s', (reason) => {
    expect(isLegacySystemDenialReason(reason)).toBe(false)
  })
})
