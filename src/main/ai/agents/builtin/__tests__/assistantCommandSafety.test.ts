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
    'grep -R "delete" src'
  ])('allows non-destructive command: %s', (command) => {
    expect(detectDestructiveAssistantCommand(command)).toBeUndefined()
  })
})

describe('detectDestructiveAssistantCommand precision', () => {
  it('does not scan the body of a heredoc that only writes a file', () => {
    expect(
      detectDestructiveAssistantCommand(
        "cd w-default && cat >> memory/topics/download.md <<'EOF'\nUse rm to delete stale downloads; never delete the archive.\nEOF"
      )
    ).toBeUndefined()
    expect(
      detectDestructiveAssistantCommand(
        "cat > /tmp/clean.ps1 <<'EOF'\nsc.exe delete MyService\nRemove-Item -Recurse C:\\temp\nEOF"
      )
    ).toBeUndefined()
  })

  it('still scans a heredoc that an interpreter executes', () => {
    expect(detectDestructiveAssistantCommand("bash <<'EOF'\nrm -rf /tmp/data\nEOF")).toBe('permanent file deletion')
    expect(detectDestructiveAssistantCommand("cat <<'EOF' | bash\nrm -rf /tmp/data\nEOF")).toBe(
      'permanent file deletion'
    )
    expect(detectDestructiveAssistantCommand("python3 - <<'PY'\nimport os\nos.remove('output.db')\nPY")).toBe(
      'scripted permanent file deletion'
    )
    expect(detectDestructiveAssistantCommand("python3 - <<'PY' 2>&1\nimport os\nos.remove('output.db')\nPY")).toBe(
      'scripted permanent file deletion'
    )
  })

  it('matches shutdown words only as commands, not as flags', () => {
    expect(
      detectDestructiveAssistantCommand('xelatex -interaction=nonstopmode -halt-on-error main.tex')
    ).toBeUndefined()
    expect(detectDestructiveAssistantCommand('rg -n "reboot|halt" docs')).toBeUndefined()
  })

  it('ignores deletion prose in a tee heredoc', () => {
    expect(detectDestructiveAssistantCommand("tee -a notes.md <<'EOF'\nrm -rf is dangerous\nEOF")).toBeUndefined()
  })

  it('keeps staged-only restore allowed while worktree restore stays blocked', () => {
    expect(detectDestructiveAssistantCommand('git restore --staged src/main.ts')).toBeUndefined()
    expect(detectDestructiveAssistantCommand('git restore --worktree src/main.ts')).toBe(
      'discarding version-control data'
    )
  })

  it('ignores file extensions and words inside quoted text or comments', () => {
    expect(detectDestructiveAssistantCommand("VE={'.mp4','.mkv','.avi','.rmvb'}")).toBeUndefined()
    expect(detectDestructiveAssistantCommand('grep -R "delete" src')).toBeUndefined()
    expect(detectDestructiveAssistantCommand('strings netdisk_service | rg "del|remove"')).toBeUndefined()
    expect(detectDestructiveAssistantCommand('printf "sc.exe delete"')).toBeUndefined()
    expect(detectDestructiveAssistantCommand('echo "rm -rf /" # rm -rf /tmp')).toBeUndefined()
  })

  it('ignores language keywords and literals in executed code', () => {
    expect(detectDestructiveAssistantCommand('python3 -c "lines = [1, 2]; del lines[0]"')).toBeUndefined()
    expect(detectDestructiveAssistantCommand('python3 -c "print(\'os.remove(x)\')"')).toBeUndefined()
    expect(detectDestructiveAssistantCommand('node -e "console.log(\'fs.rmSync\')"')).toBeUndefined()
  })

  it('still detects deletion expressed inside executed code', () => {
    expect(detectDestructiveAssistantCommand('python3 -c "import os; os.remove(\'output.db\')"')).toBe(
      'scripted permanent file deletion'
    )
    expect(detectDestructiveAssistantCommand('node -e "fs.rmSync(\'build\', { recursive: true })"')).toBe(
      'scripted permanent file deletion'
    )
    expect(detectDestructiveAssistantCommand("sh -lc 'rm -rf /tmp/data'")).toBe('permanent file deletion')
    expect(detectDestructiveAssistantCommand('echo $(rm -rf /tmp/data)')).toBe('permanent file deletion')
  })

  it('looks through wrappers and interpreter flags', () => {
    expect(detectDestructiveAssistantCommand('sudo -u root rm -rf /tmp/data')).toBe('permanent file deletion')
    expect(detectDestructiveAssistantCommand('xargs -0 rm -f')).toBe('permanent file deletion')
    expect(detectDestructiveAssistantCommand('busybox rm -rf /tmp/data')).toBe('permanent file deletion')
    expect(detectDestructiveAssistantCommand('pkexec rm -rf /tmp/data')).toBe('permanent file deletion')
    expect(detectDestructiveAssistantCommand("time -f '%e' rm -rf /tmp/data")).toBe('permanent file deletion')
    expect(detectDestructiveAssistantCommand('exec -a worker rm -rf /tmp/data')).toBe('permanent file deletion')
    expect(detectDestructiveAssistantCommand('powershell -NoProfile -Command "Remove-Item -Recurse C:\\temp"')).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand('powershell -NoProfile Remove-Item -Recurse C:\\temp')).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand('sc.exe delete MyService')).toBe('system shutdown or service destruction')
  })

  it('resolves commands executed through remote and container wrappers', () => {
    expect(detectDestructiveAssistantCommand('ssh -p 22 host rm -rf /data')).toBe('permanent file deletion')
    expect(detectDestructiveAssistantCommand('ssh host "echo rm"')).toBeUndefined()
    expect(detectDestructiveAssistantCommand('docker exec -it app rm -rf /data')).toBe('permanent file deletion')
    expect(detectDestructiveAssistantCommand('docker run --rm -v /home/u:/data alpine rm -rf /data/x')).toBe(
      'permanent file deletion'
    )
    expect(detectDestructiveAssistantCommand('docker run --rm alpine echo rm')).toBeUndefined()
    expect(detectDestructiveAssistantCommand('kubectl exec -it pod -- rm -rf /data')).toBe('permanent file deletion')
    expect(detectDestructiveAssistantCommand("su -c 'rm -rf /tmp/x'")).toBe('permanent file deletion')
    expect(detectDestructiveAssistantCommand('chroot /mnt rm -rf /x')).toBe('permanent file deletion')
  })

  it('does not treat command -v or a bare shell flag as execution', () => {
    expect(detectDestructiveAssistantCommand('command -v rm')).toBeUndefined()
    expect(detectDestructiveAssistantCommand('bash -e script.sh')).toBeUndefined()
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
