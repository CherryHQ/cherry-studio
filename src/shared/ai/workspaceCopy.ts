export function workspaceCopyFailureReason(code: string | null | undefined) {
  switch (code) {
    case 'workspace_in_use':
      return 'workspace_in_use'
    case 'source_changed':
      return 'source_changed'
    case 'invalid_storage':
    case 'EACCES':
    case 'EPERM':
      return 'invalid_storage'
    case 'ENOSPC':
    case 'EDQUOT':
      return 'not_enough_space'
    case 'ownership_mismatch':
    case 'unknown_entry':
    case 'ENOTEMPTY':
      return 'ownership_mismatch'
    case 'unsupported_entry':
    case 'unsupported_link':
      return 'unsupported_entry'
    case 'writes_paused':
      return 'writes_paused'
    default:
      return 'operation_failed'
  }
}
