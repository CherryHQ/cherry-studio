/**
 * These strings came from older Cherry Studio UI code at de2bc0aed0: PermissionRequestComposer,
 * AskUserQuestionComposer, and useToolApproval. This PR removed all three writers, closing the list.
 * The AI SDK UI message schema drops extra fields on persisted approval objects, so historical
 * rows have no readable source flag. Match only after trim and only by exact equality; substring
 * or prefix matches could mistake user-written reasons for these UI fallbacks.
 */
const LEGACY_SYSTEM_DENIAL_REASONS = new Set([
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
])

export function isLegacySystemDenialReason(reason: string): boolean {
  return LEGACY_SYSTEM_DENIAL_REASONS.has(reason.trim())
}
