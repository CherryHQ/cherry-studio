import { describe, expect, it } from 'vitest'

import {
  detectDestructiveAssistantCommand,
  isGitHubIssueCreationCommand,
  isLarkFormSubmissionCommand,
  isPermanentDeletionToolName
} from '../assistantCommandSafety'

describe('detectDestructiveAssistantCommand', () => {
  it.each([
    ['rm -rf ./build', 'permanent file deletion'],
    ['powershell Remove-Item -Recurse C:\\temp', 'permanent Windows file deletion'],
    ['powershell rmdir C:\\temp', 'permanent Windows file deletion'],
    ['cmd /c del /s /q C:\\temp\\*', 'permanent Windows file deletion'],
    ['cmd /c if 1==1 del /q victim.txt', 'permanent Windows file deletion'],
    ['if defined SHOULD_DELETE del victim.txt', 'permanent Windows file deletion'],
    ['if exist "my file.txt" del /q "my file.txt"', 'permanent Windows file deletion'],
    ['if ERRORLEVEL 1 del victim.txt', 'permanent Windows file deletion'],
    ['if "%X%"=="y" del victim.txt', 'permanent Windows file deletion'],
    ['if /i not exist "a b.txt" erase "a b.txt"', 'permanent Windows file deletion'],
    ['powershell del foo', 'permanent Windows file deletion'],
    ['pwsh del foo', 'permanent Windows file deletion'],
    ['powershell.exe del foo', 'permanent Windows file deletion'],
    ['pwsh.exe del victim.txt', 'permanent Windows file deletion'],
    ['powershell -nop -ep bypass del foo', 'permanent Windows file deletion'],
    ['powershell.exe -NoProfile del foo', 'permanent Windows file deletion'],
    ['DEL /Q file.txt', 'permanent Windows file deletion'],
    ['echo hi && del file.txt', 'permanent Windows file deletion'],
    ['if exist a.txt del a.txt', 'permanent Windows file deletion'],
    ['for %i in (*) do erase %i', 'permanent Windows file deletion'],
    ['cmd /c rd /s /q build', 'permanent Windows file deletion'],
    ['powershell -Command "del foo"', 'permanent Windows file deletion'],
    ['bash -c "del foo"', 'permanent Windows file deletion'],
    ['python -c "import shutil; shutil.rmtree(\'output\')"', 'scripted permanent file deletion'],
    ['find . -name "*.tmp" -delete', 'recursive find deletion'],
    ['diskutil eraseDisk APFS Empty /dev/disk4', 'disk formatting or wiping'],
    ['git reset --hard HEAD~1', 'discarding version-control data'],
    ['git checkout .', 'discarding version-control data'],
    ['git checkout HEAD -- src/main.ts', 'discarding version-control data'],
    ['git checkout -f feature', 'discarding version-control data'],
    ['git checkout feature --force', 'discarding version-control data'],
    ['git switch --discard-changes feature', 'discarding version-control data'],
    ['git -C nested clean -fdx', 'discarding version-control data'],
    ['git -C "nested repo" reset --hard', 'discarding version-control data'],
    ['git --git-dir=.git --work-tree=. clean -fd', 'discarding version-control data'],
    ['git --work-tree . reset --hard', 'discarding version-control data'],
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
    'git -C nested status --short',
    'git --work-tree=. diff --check',
    'git checkout feature-branch',
    'git switch feature-branch',
    'mkdir -p output',
    'mv draft.md final.md',
    'cp source.md backup.md',
    'grep -R "delete" src',
    'pwd && ls -la "T:/Some folder del something"',
    'cd "T:/Archivo General" && mkdir -p test && echo "prueba de tanteo del Bibliotecario" > test/file.txt && ls -la test',
    'echo "DEL del Rd erase"',
    'ls modelo'
  ])('allows non-destructive command: %s', (command) => {
    expect(detectDestructiveAssistantCommand(command)).toBeUndefined()
  })

  it('stays linear on long adversarial input and still detects quoted long-operand conditionals', () => {
    // Many conditional-looking starts that all fail at the end: worst case for the prefix branches.
    const probe = `echo "${'if ' + 'a'.repeat(99) + '==b '.repeat(1)}`.repeat(2000)
    expect(probe.length).toBeGreaterThan(200_000)
    const start = performance.now()
    expect(detectDestructiveAssistantCommand(probe)).toBeUndefined()
    // A quadratic pattern takes seconds here (measured ~13s at 100k chars pre-bounding); 2s is generous CI headroom.
    expect(performance.now() - start).toBeLessThan(2000)

    const longQuoted = `if "${'a'.repeat(60_000)}"=="${'b'.repeat(60_000)}" del victim.txt`
    expect(detectDestructiveAssistantCommand(longQuoted)).toBe('permanent Windows file deletion')
  })

  it('keeps the pre-existing unbounded bare exist operand (257+ chars still blocked)', () => {
    const longToken = 'x'.repeat(300)
    expect(detectDestructiveAssistantCommand(`if exist ${longToken} del victim.txt`)).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand(`exist ${longToken} del victim.txt`)).toBe(
      'permanent Windows file deletion'
    )
    // Stays linear on a very long bare exist token.
    const huge = `exist ${'y'.repeat(400_000)} del victim.txt`
    const start = performance.now()
    expect(detectDestructiveAssistantCommand(huge)).toBe('permanent Windows file deletion')
    expect(performance.now() - start).toBeLessThan(2000)
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

describe('isLarkFormSubmissionCommand', () => {
  it.each([
    'lark-cli base +form-submit --share-token token --as user --json fields.json --yes',
    '/usr/local/bin/lark-cli base +form-submit --share-token token',
    '"/Applications/Lark CLI/lark-cli" base +form-submit --share-token token'
  ])('detects %s', (command) => {
    expect(isLarkFormSubmissionCommand(command)).toBe(true)
  })

  it.each([
    'lark-cli auth status --json --verify',
    'lark-cli base +form-detail --share-token token --format json',
    'printf "lark-cli base +form-submit"'
  ])('allows non-submission command: %s', (command) => {
    expect(isLarkFormSubmissionCommand(command)).toBe(false)
  })
})

describe('isGitHubIssueCreationCommand', () => {
  it.each([
    'gh issue create --repo CherryHQ/cherry-studio --title "Bug" --body-file report.md',
    '  gh issue create --repo CherryHQ/cherry-studio',
    '/usr/local/bin/gh issue create --repo CherryHQ/cherry-studio',
    'cd /workspace && "C:\\Program Files\\GitHub CLI\\gh" issue create --title "Bug"'
  ])('detects %s', (command) => {
    expect(isGitHubIssueCreationCommand(command)).toBe(true)
  })

  it.each([
    'gh issue list --repo CherryHQ/cherry-studio',
    'gh search issues "startup crash" --repo CherryHQ/cherry-studio',
    'printf "gh issue create"',
    'echo gh issue create',
    'laugh issue create'
  ])('allows non-creation command: %s', (command) => {
    expect(isGitHubIssueCreationCommand(command)).toBe(false)
  })
})
