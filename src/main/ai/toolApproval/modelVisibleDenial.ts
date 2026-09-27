import { isAskUserQuestionToolName } from './askUserQuestionToolName'
import type { DispatchDecision } from './ToolApprovalRegistry'

// These are closed legacy UI fallbacks from de2bc0aed0, never user input on those paths.
// This PR removed all three writers: PermissionRequestComposer, AskUserQuestionComposer, and useToolApproval.
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

export function modelVisibleDenial(
  decision: Extract<DispatchDecision, { approved: false }>,
  toolName?: string
): string {
  if (decision.source === 'host') return decision.hostReason

  if (!decision.reason?.trim() || LEGACY_SYSTEM_DENIAL_REASONS.has(decision.reason.trim())) {
    if (isAskUserQuestionToolName(toolName)) {
      return 'The user ignored this question without answering. The tool did not execute. The user is waiting for your instructions.'
    }
    return 'The user denied permission to use this tool. The tool did not execute. The user gave no reason and is waiting for your instructions.'
  }

  const prefix = `The user denied permission to use ${toolName ?? 'this tool'}. The tool did not execute.`
  let marker = '<<<USER_WORDS>>>'
  while (decision.reason.includes(marker)) marker = `<${marker}>`
  return `${prefix} The user's exact words are between these markers:\n${marker}\n${decision.reason}\n${marker}`
}
