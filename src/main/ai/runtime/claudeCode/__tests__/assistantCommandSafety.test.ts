import { describe, expect, it } from 'vitest'

import { detectDestructiveAssistantCommand, isPermanentDeletionToolName } from '../assistantCommandSafety'

describe('detectDestructiveAssistantCommand', () => {
  it.each([
    ['rm -rf ./build', 'permanent file deletion'],
    ['powershell Remove-Item -Recurse C:\\temp', 'permanent Windows file deletion'],
    ['powershell rmdir C:\\temp', 'permanent Windows file deletion'],
    ['cmd /c del /s /q C:\\temp\\*', 'permanent Windows file deletion'],
    ['python -c "import shutil; shutil.rmtree(\'output\')"', 'scripted permanent file deletion'],
    ['find . -name "*.tmp" -delete', 'recursive find deletion'],
    ['diskutil eraseDisk APFS Empty /dev/disk4', 'disk formatting or wiping'],
    ['git reset --hard HEAD~1', 'discarding version-control data'],
    ['sqlite3 app.db "DROP TABLE users"', 'destructive database operation'],
    ['terraform destroy -auto-approve', 'destructive infrastructure operation'],
    ['sudo shutdown -h now', 'system shutdown or service destruction'],
    ['history -c', 'security-log or shell-history erasure'],
    [':(){ :|:& };:', 'a process-exhaustion payload']
  ])('blocks %s', (command, reason) => {
    expect(detectDestructiveAssistantCommand(command)).toBe(reason)
  })

  it.each([
    'pnpm test',
    'pnpm format',
    'git diff --check',
    'mkdir -p output',
    'mv draft.md final.md',
    'cp source.md backup.md',
    'grep -R "delete" src'
  ])('allows non-destructive command: %s', (command) => {
    expect(detectDestructiveAssistantCommand(command)).toBeUndefined()
  })
})

describe('isPermanentDeletionToolName', () => {
  it.each([
    'mcp__filesystem__delete',
    'mcp__files__delete_file',
    'mcp__files__delete_directory',
    'mcp__files__remove_file',
    'mcp__files__remove_directory'
  ])('detects %s', (toolName) => {
    expect(isPermanentDeletionToolName(toolName)).toBe(true)
  })

  it.each(['Bash', 'mcp__assistant-files__move_to_trash', 'mcp__cherry-tools__kb_manage'])(
    'does not misclassify %s',
    (toolName) => {
      expect(isPermanentDeletionToolName(toolName)).toBe(false)
    }
  )
})
