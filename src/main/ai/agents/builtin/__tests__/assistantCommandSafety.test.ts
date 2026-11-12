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
    ['printf text > "$(rm -f victim; printf note)"', 'permanent file deletion'],
    ['> "$(rm -f victim; printf note)"', 'permanent file deletion'],
    ['x=$(rm -f victim)', 'permanent file deletion'],
    ['seed=$(rm -f victim); echo done', 'permanent file deletion'],
    ['terraform destroy -auto-approve', 'destructive infrastructure operation'],
    ['docker container rm -f -v app', 'destructive infrastructure operation'],
    ['docker image rm app', 'destructive infrastructure operation'],
    ['docker container prune -f', 'destructive infrastructure operation'],
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
    'docker container ls -a',
    'docker volume create myvol'
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

describe('detectDestructiveAssistantCommand compound commands', () => {
  it.each([
    ['if [ -f victim ]; then rm -f victim; fi', 'permanent file deletion'],
    ['if [ -f a ]; then echo a; elif [ -f b ]; then rm -f b; fi', 'permanent file deletion'],
    ['for f in a b; do rm -f "$f"; done', 'permanent file deletion'],
    ['while true; do rm -f victim; done', 'permanent file deletion'],
    ['until false; do rm -f victim; done', 'permanent file deletion'],
    ['{ rm -f victim; }', 'permanent file deletion'],
    ['if [ -f victim ]\nthen\nrm -f victim\nfi', 'permanent file deletion'],
    ['! rm -f victim', 'permanent file deletion'],
    ['( if true; then rm -f victim; fi )', 'permanent file deletion']
  ])('resolves the body of %s', (command, reason) => {
    expect(detectDestructiveAssistantCommand(command)).toBe(reason)
  })

  it('still allows compound bodies that only read or report', () => {
    expect(detectDestructiveAssistantCommand('if [ -f README.md ]; then echo found; fi')).toBeUndefined()
    expect(detectDestructiveAssistantCommand('for f in *.md; do echo "$f"; done')).toBeUndefined()
    expect(detectDestructiveAssistantCommand('while read -r line; do echo "$line"; done < list.txt')).toBeUndefined()
    expect(detectDestructiveAssistantCommand('{ echo hi; }')).toBeUndefined()
    expect(detectDestructiveAssistantCommand('case $mode in a) echo a;; esac')).toBeUndefined()
  })
})

describe('detectDestructiveAssistantCommand heredocs', () => {
  it('analyzes expansions an unquoted heredoc evaluates before its consumer reads it', () => {
    expect(detectDestructiveAssistantCommand('cat > note <<EOF\n$(rm -f victim)\nEOF')).toBe('permanent file deletion')
    expect(detectDestructiveAssistantCommand('cat > note <<EOF\n`rm -f victim`\nEOF')).toBe('permanent file deletion')
    expect(detectDestructiveAssistantCommand('cat > note <<EOF\n$(sh -c "rm -f victim")\nEOF')).toBe(
      'permanent file deletion'
    )
    expect(detectDestructiveAssistantCommand('cat > note <<EOF\n${payload:-$(rm -f victim)}\nEOF')).toBe(
      'permanent file deletion'
    )
    // Quotes and `#` are literal text in a heredoc body, so neither suppresses the expansion.
    expect(detectDestructiveAssistantCommand("cat > note <<EOF\n'$(rm -f victim)'\nEOF")).toBe(
      'permanent file deletion'
    )
    expect(detectDestructiveAssistantCommand('cat > note <<EOF\n# $(rm -f victim)\nEOF')).toBe(
      'permanent file deletion'
    )
  })

  it('leaves a quoted-delimiter heredoc and literal prose inert', () => {
    expect(detectDestructiveAssistantCommand("cat > note <<'EOF'\n$(rm -f victim)\nEOF")).toBeUndefined()
    expect(detectDestructiveAssistantCommand('cat > note <<EOF\nrm -rf is dangerous\nEOF')).toBeUndefined()
  })

  it('analyzes SQL a database client reads from stdin', () => {
    expect(detectDestructiveAssistantCommand("sqlite3 app.db <<'SQL'\nDROP TABLE users;\nSQL")).toBe(
      'destructive database operation'
    )
    expect(detectDestructiveAssistantCommand("mysql -u root <<'SQL'\ndelete from users;\nSQL")).toBe(
      'destructive database operation'
    )
    expect(detectDestructiveAssistantCommand("psql -U root <<'SQL'\nTRUNCATE TABLE users;\nSQL")).toBe(
      'destructive database operation'
    )
    expect(detectDestructiveAssistantCommand('sqlite3 app.db <<< "DROP TABLE users"')).toBe(
      'destructive database operation'
    )
  })

  it('allows read-only SQL on stdin', () => {
    expect(detectDestructiveAssistantCommand("sqlite3 app.db <<'SQL'\nSELECT * FROM users;\nSQL")).toBeUndefined()
    expect(detectDestructiveAssistantCommand("echo '.tables' | sqlite3 app.db <<'SQL'\nSELECT 1;\nSQL")).toBeUndefined()
  })
})

describe('detectDestructiveAssistantCommand executors', () => {
  it('keeps argv intact for executors that do not use a shell', () => {
    expect(detectDestructiveAssistantCommand('docker exec app python3 -c \'import os; os.remove("victim")\'')).toBe(
      'scripted permanent file deletion'
    )
    expect(detectDestructiveAssistantCommand("docker exec -u root app sh -c 'rm -rf /data'")).toBe(
      'permanent file deletion'
    )
    expect(detectDestructiveAssistantCommand('kubectl exec -n ns pod python3 -c \'import os; os.remove("x")\'')).toBe(
      'scripted permanent file deletion'
    )
    expect(detectDestructiveAssistantCommand('chroot /mnt python3 -c \'import os; os.remove("x")\'')).toBe(
      'scripted permanent file deletion'
    )
    expect(detectDestructiveAssistantCommand('docker exec app echo rm -rf /x')).toBeUndefined()
    expect(detectDestructiveAssistantCommand('docker exec -it app ls -la /data')).toBeUndefined()
  })

  it('covers nested docker removal subcommands', () => {
    expect(detectDestructiveAssistantCommand('docker container rm -f -v app')).toBe(
      'destructive infrastructure operation'
    )
    expect(detectDestructiveAssistantCommand('docker image rm app')).toBe('destructive infrastructure operation')
    expect(detectDestructiveAssistantCommand('docker image prune -a')).toBe('destructive infrastructure operation')
    expect(detectDestructiveAssistantCommand('docker volume prune')).toBe('destructive infrastructure operation')
    expect(detectDestructiveAssistantCommand('docker network rm bridge')).toBe('destructive infrastructure operation')
    expect(detectDestructiveAssistantCommand('docker image inspect rm')).toBeUndefined()
    expect(detectDestructiveAssistantCommand('docker volume create myvol')).toBeUndefined()
  })
})

describe('detectDestructiveAssistantCommand scripts', () => {
  it('analyzes template-literal interpolations in executed JavaScript', () => {
    expect(
      detectDestructiveAssistantCommand('node -e \'const fs=require("fs"); console.log(`${fs.unlinkSync("victim")}`)\'')
    ).toBe('scripted permanent file deletion')
    expect(detectDestructiveAssistantCommand('node -e \'console.log(`${`${require("fs").rmSync("x")}`}`)\'')).toBe(
      'scripted permanent file deletion'
    )
    expect(detectDestructiveAssistantCommand('node -e \'const o={v:`${fs.rmdirSync("x")}`}; console.log(o)\'')).toBe(
      'scripted permanent file deletion'
    )
    // A brace inside a comment does not close the interpolation.
    expect(detectDestructiveAssistantCommand('node -e \'console.log(`${/* } */ fs.unlinkSync("victim")}`)\'')).toBe(
      'scripted permanent file deletion'
    )
    expect(detectDestructiveAssistantCommand('node -e \'console.log(`${ // }\n fs.unlinkSync("victim")}`)\'')).toBe(
      'scripted permanent file deletion'
    )
  })

  it('ignores template-literal text and harmless interpolations', () => {
    expect(detectDestructiveAssistantCommand('node -e \'console.log(`fs.rmSync("x")`)\'')).toBeUndefined()
    expect(detectDestructiveAssistantCommand("node -e 'console.log(`a ${{b: 1}.b}`)'")).toBeUndefined()
    expect(detectDestructiveAssistantCommand('node -e \'const n = "x"; console.log(`file ${n}`)\'')).toBeUndefined()
  })

  it('reads a slash before a character class as a regular expression, not a comment', () => {
    // `/[/*]/` and `/[//]/` hold the comment delimiters inside a class and must not swallow the boundary.
    expect(
      detectDestructiveAssistantCommand(
        'node -e \'const fs=require("fs"); const x = ${/[/*]/}; fs.unlinkSync("victim")\''
      )
    ).toBe('scripted permanent file deletion')
    expect(
      detectDestructiveAssistantCommand(
        'node -e \'const fs=require("fs"); const x = ${/[//]/}; fs.unlinkSync("victim")\''
      )
    ).toBe('scripted permanent file deletion')
    expect(
      detectDestructiveAssistantCommand(
        'node -e \'const fs=require("fs"); console.log(`${/[/*]/}`, `${fs.unlinkSync("victim")}`)\''
      )
    ).toBe('scripted permanent file deletion')
    // A real regex is not prose: what follows it in the same interpolation still runs.
    expect(
      detectDestructiveAssistantCommand(
        'node -e \'const fs=require("fs"); console.log(`${/a\\/b/.test(x)}`); fs.rmdirSync("victim")\''
      )
    ).toBe('scripted permanent file deletion')
  })

  it('keeps division out of regular-expression scanning', () => {
    expect(detectDestructiveAssistantCommand("node -e 'const a=6, b=2; console.log(`${a / b}`)'")).toBeUndefined()
    expect(detectDestructiveAssistantCommand('node -e \'const x="p"; console.log(`${x.length / 2}`)\'')).toBeUndefined()
    // Whitespace before the slash does not make it a regex start; the last token decides. A pair of
    // divisions would otherwise open a scan at the first slash and swallow the deletion between them.
    expect(
      detectDestructiveAssistantCommand(
        'node -e \'const fs=require("fs"); const a=8 / 2; fs.unlinkSync("victim"); const b=6 / 3;\''
      )
    ).toBe('scripted permanent file deletion')
    expect(
      detectDestructiveAssistantCommand(
        'node -e \'const fs=require("fs"); const a = 10 / 2; fs.rmdirSync("victim"); const b = 4 / 2;\''
      )
    ).toBe('scripted permanent file deletion')
    // The same pairing inside a template interpolation, where the expression is sliced alone.
    expect(
      detectDestructiveAssistantCommand(
        'node -e \'const fs=require("fs"); console.log(`${8 / 2}`, `${fs.unlinkSync("victim")}`, `${6 / 3}`)\''
      )
    ).toBe('scripted permanent file deletion')
    // A comment between the operands ends with the character under test, so it has to be skipped
    // rather than treated as the thing being divided.
    expect(
      detectDestructiveAssistantCommand(
        'node -e \'const fs=require("fs"); const a=8 /* n */ / 2; fs.unlinkSync("victim"); const b=6 / 3;\''
      )
    ).toBe('scripted permanent file deletion')
    expect(
      detectDestructiveAssistantCommand(
        'node -e \'const fs=require("fs"); const a=8 // n\n / 2; fs.unlinkSync("victim"); const b=6 / 3;\''
      )
    ).toBe('scripted permanent file deletion')
    // A block or object literal closes an expression, so the `/` after it divides.
    expect(
      detectDestructiveAssistantCommand(
        'node -e \'const fs=require("fs"); const a={} / 2; fs.unlinkSync("victim"); const b=6 / 3;\''
      )
    ).toBe('scripted permanent file deletion')
    // A `//` in a URL string is not a comment, and a comment on an earlier line belongs to that
    // line: only trivia touching the token before the slash may be stepped over.
    expect(
      detectDestructiveAssistantCommand(
        'node -e \'const fs=require("fs"); const url="https://example.com"; const a=8 / 2; fs.unlinkSync("victim"); const b=6 / 3;\''
      )
    ).toBe('scripted permanent file deletion')
    expect(
      detectDestructiveAssistantCommand(
        'node -e \'const fs=require("fs"); const a=8;\n// note\nconst b=a / 2; fs.unlinkSync("victim"); const c=b / 4;\''
      )
    ).toBe('scripted permanent file deletion')
  })

  it('does not treat a consumed regular expression as hiding what follows it', () => {
    // A regex whose pattern cannot close before the next slash falls back to division, so the code
    // after it stays visible to the deletion patterns.
    expect(
      detectDestructiveAssistantCommand('node -e \'const fs=require("fs"); const q = a / b; fs.unlinkSync("victim")\'')
    ).toBe('scripted permanent file deletion')
    expect(
      detectDestructiveAssistantCommand(
        'node -e \'const fs=require("fs"); const a = b / c; fs.rmSync("victim"); const d = e / f;\''
      )
    ).toBe('scripted permanent file deletion')
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

describe('CMD conditional command positions', () => {
  it.each([
    'if exist victim.txt del /q victim.txt',
    'if defined SHOULD_DELETE del victim.txt',
    'if ERRORLEVEL 1 del victim.txt',
    'if CMDEXTVERSION 2 rd /s /q victim',
    'if /i not exist "a b.txt" erase "a b.txt"',
    'if 1==1 del victim.txt',
    'if 1 == 1 del victim.txt',
    'if 1 ==1 del victim.txt',
    'if 1== 1 del victim.txt',
    'if "a"=="b" del victim.txt',
    'if 1 EQU 1 del victim.txt',
    'if /i not "a" NEQ "b" erase victim.txt',
    'cmd /c if exist victim.txt del victim.txt',
    'cmd /c if 1==1 del victim.txt',
    'cmd /c if 1 EQU 1 del victim.txt',
    'cmd /c if /i not "a" NEQ "b" erase victim.txt',
    'cmd /c @ del victim.txt',
    'cmd /c @@del victim.txt',
    'cmd /c @ @ del victim.txt',
    'if exist victim.txt @rd /s /q victim',
    'if exist victim.txt @ rd /s /q victim',
    'echo hi && @ del victim.txt',
    'if exist outer if defined INNER del victim.txt'
  ])('denies the executable conditional body: %s', (command) => {
    expect(detectDestructiveAssistantCommand(command)).toBe('permanent Windows file deletion')
  })

  it.each([
    'echo "if exist a del b"',
    'echo "if 1==1 del b"',
    'echo "prueba de tanteo del Bibliotecario"',
    'ls "T:/folder del something"',
    'if exist del echo safe',
    'if defined del echo safe',
    'if "del"=="erase" echo safe',
    'if 1 EQU 1 echo del',
    'cmd /c if exist del echo safe',
    'echo @del'
  ])('does not treat condition operands or prose as commands: %s', (command) => {
    expect(detectDestructiveAssistantCommand(command)).toBeUndefined()
  })

  it('consumes long nested conditional prefixes without rescanning the suffix', () => {
    const command = 'if exist a '.repeat(20000) + 'del victim.txt'
    expect(detectDestructiveAssistantCommand(command)).toBe('permanent Windows file deletion')
  })
})

describe('CMD empty quoted equality operands', () => {
  for (const prefix of ['', 'cmd /c ', 'cmd.exe /k ']) {
    for (const condition of [
      '"%x%"==""',
      '"a"==""',
      '""==""',
      '""=="a"',
      '"a" == ""',
      '"" == ""',
      '"a"== ""',
      '"" =="a"'
    ]) {
      it(`denies ${prefix}if ${condition} del`, () => {
        expect(detectDestructiveAssistantCommand(`${prefix}if ${condition} del b`)).toBe(
          'permanent Windows file deletion'
        )
        expect(detectDestructiveAssistantCommand(`${prefix}if ${condition} rd /s x`)).toBe(
          'permanent Windows file deletion'
        )
      })
      it(`allows ${prefix}if ${condition} echo del`, () => {
        expect(detectDestructiveAssistantCommand(`${prefix}if ${condition} echo del x`)).toBeUndefined()
      })
    }
  }
})

describe('CMD quote stripping for nested command programs', () => {
  it.each([
    'cmd /c "cmd /c "del b""',
    'cmd /c "cmd /c "if exist a del b""',
    'cmd /k "cmd /c "del b""',
    // Keep main's conservative deny for a quoted executable plus another quoted word.
    'cmd /c "del b" "c"'
  ])('retains deletion detection after whole-program quote stripping: %s', (command) => {
    expect(detectDestructiveAssistantCommand(command)).toBe('permanent Windows file deletion')
  })
  it.each(['cmd /c "cmd /c "echo del""', 'cmd /c "cmd /c "if exist a echo del""'])(
    'does not mistake nested prose for execution: %s',
    (command) => {
      expect(detectDestructiveAssistantCommand(command)).toBeUndefined()
    }
  )
})

describe('CMD START command dispatch', () => {
  it.each([
    'cmd /c start /b del victim.txt',
    'cmd /c "@start /b del victim.txt"',
    'cmd /c "@@start /min /b del victim.txt"',
    'cmd /c start "t" /min del victim.txt',
    'cmd /c start /d C:\\work del victim.txt',
    'cmd /c start /node 0 /affinity ff /machine amd64 del victim.txt',
    'cmd /c start /b start /wait del victim.txt',
    'cmd /c start "my start /b menu" /min del victim.txt',
    'cmd /c start /b "" del victim.txt',
    'start "restart job" del victim.txt',
    'cmd /c "2> "log file.txt" del victim.txt"',
    'cmd /c "1> out.txt 2>&1 del victim.txt"'
  ])('denies the dispatched deletion: %s', (command) => {
    expect(detectDestructiveAssistantCommand(command)).toBe('permanent Windows file deletion')
  })

  it.each([
    'cmd /c start "del" echo hello',
    'cmd /c start "my start menu" echo del victim.txt',
    'cmd /c start /d del echo hello',
    'cmd /c start /node del echo hello',
    'cmd /c start /affinity del echo hello',
    'cmd /c start /machine del echo hello',
    'cmd /c start /?',
    'cmd /c start /unknown del victim.txt',
    'cmd /c start the job and del the files',
    'cmd /c start "del victim.txt"',
    'cmd /c start "" echo del victim.txt',
    'cmd /c "2> "del victim.txt" echo hello"'
  ])('does not treat a title, option value or argument as the command: %s', (command) => {
    expect(detectDestructiveAssistantCommand(command)).toBeUndefined()
  })

  it('walks nested START wrappers without recursion or suffix rescans', () => {
    expect(detectDestructiveAssistantCommand('cmd /c ' + 'start /b '.repeat(20000) + 'del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
  })
})
