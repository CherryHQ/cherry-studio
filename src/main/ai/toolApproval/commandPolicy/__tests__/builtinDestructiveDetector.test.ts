import { beforeAll, describe, expect, it } from 'vitest'

import { detectBuiltinDestructiveCommand } from '../builtinDestructiveDetector'
import { initializeCommandParser } from '../commandParser'

beforeAll(initializeCommandParser)

describe('detectBuiltinDestructiveCommand', () => {
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
    expect(detectBuiltinDestructiveCommand(command)).toBe(reason)
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
    expect(detectBuiltinDestructiveCommand(command)).toBeUndefined()
  })
})

describe('detectBuiltinDestructiveCommand precision', () => {
  it('does not scan the body of a heredoc that only writes a file', () => {
    expect(
      detectBuiltinDestructiveCommand(
        "cd w-default && cat >> memory/topics/download.md <<'EOF'\nUse rm to delete stale downloads; never delete the archive.\nEOF"
      )
    ).toBeUndefined()
    expect(
      detectBuiltinDestructiveCommand(
        "cat > /tmp/clean.ps1 <<'EOF'\nsc.exe delete MyService\nRemove-Item -Recurse C:\\temp\nEOF"
      )
    ).toBeUndefined()
  })

  it('still scans a heredoc that an interpreter executes', () => {
    expect(detectBuiltinDestructiveCommand("bash <<'EOF'\nrm -rf /tmp/data\nEOF")).toBe('permanent file deletion')
    expect(detectBuiltinDestructiveCommand("cat <<'EOF' | bash\nrm -rf /tmp/data\nEOF")).toBe('permanent file deletion')
    expect(detectBuiltinDestructiveCommand("python3 - <<'PY'\nimport os\nos.remove('output.db')\nPY")).toBe(
      'scripted permanent file deletion'
    )
    expect(detectBuiltinDestructiveCommand("python3 - <<'PY' 2>&1\nimport os\nos.remove('output.db')\nPY")).toBe(
      'scripted permanent file deletion'
    )
  })

  it('matches shutdown words only as commands, not as flags', () => {
    expect(detectBuiltinDestructiveCommand('xelatex -interaction=nonstopmode -halt-on-error main.tex')).toBeUndefined()
    expect(detectBuiltinDestructiveCommand('rg -n "reboot|halt" docs')).toBeUndefined()
  })

  it('ignores deletion prose in a tee heredoc', () => {
    expect(detectBuiltinDestructiveCommand("tee -a notes.md <<'EOF'\nrm -rf is dangerous\nEOF")).toBeUndefined()
  })

  it('keeps staged-only restore allowed while worktree restore stays blocked', () => {
    expect(detectBuiltinDestructiveCommand('git restore --staged src/main.ts')).toBeUndefined()
    expect(detectBuiltinDestructiveCommand('git restore --worktree src/main.ts')).toBe(
      'discarding version-control data'
    )
  })

  it('ignores file extensions and words inside quoted text or comments', () => {
    expect(detectBuiltinDestructiveCommand("VE={'.mp4','.mkv','.avi','.rmvb'}")).toBeUndefined()
    expect(detectBuiltinDestructiveCommand('grep -R "delete" src')).toBeUndefined()
    expect(detectBuiltinDestructiveCommand('strings netdisk_service | rg "del|remove"')).toBeUndefined()
    expect(detectBuiltinDestructiveCommand('printf "sc.exe delete"')).toBeUndefined()
    expect(detectBuiltinDestructiveCommand('echo "rm -rf /" # rm -rf /tmp')).toBeUndefined()
  })

  it('ignores language keywords and literals in executed code', () => {
    expect(detectBuiltinDestructiveCommand('python3 -c "lines = [1, 2]; del lines[0]"')).toBeUndefined()
    expect(detectBuiltinDestructiveCommand('python3 -c "print(\'os.remove(x)\')"')).toBeUndefined()
    expect(detectBuiltinDestructiveCommand('node -e "console.log(\'fs.rmSync\')"')).toBeUndefined()
  })

  it('still detects deletion expressed inside executed code', () => {
    expect(detectBuiltinDestructiveCommand('python3 -c "import os; os.remove(\'output.db\')"')).toBe(
      'scripted permanent file deletion'
    )
    expect(detectBuiltinDestructiveCommand('node -e "fs.rmSync(\'build\', { recursive: true })"')).toBe(
      'scripted permanent file deletion'
    )
    expect(detectBuiltinDestructiveCommand("sh -lc 'rm -rf /tmp/data'")).toBe('permanent file deletion')
    expect(detectBuiltinDestructiveCommand('echo $(rm -rf /tmp/data)')).toBe('permanent file deletion')
  })

  it('looks through wrappers and interpreter flags', () => {
    expect(detectBuiltinDestructiveCommand('sudo -u root rm -rf /tmp/data')).toBe('permanent file deletion')
    expect(detectBuiltinDestructiveCommand('xargs -0 rm -f')).toBe('permanent file deletion')
    expect(detectBuiltinDestructiveCommand('busybox rm -rf /tmp/data')).toBe('permanent file deletion')
    expect(detectBuiltinDestructiveCommand('pkexec rm -rf /tmp/data')).toBe('permanent file deletion')
    expect(detectBuiltinDestructiveCommand("time -f '%e' rm -rf /tmp/data")).toBe('permanent file deletion')
    expect(detectBuiltinDestructiveCommand('exec -a worker rm -rf /tmp/data')).toBe('permanent file deletion')
    expect(detectBuiltinDestructiveCommand('powershell -NoProfile -Command "Remove-Item -Recurse C:\\temp"')).toBe(
      'permanent Windows file deletion'
    )
    expect(detectBuiltinDestructiveCommand('powershell -NoProfile Remove-Item -Recurse C:\\temp')).toBe(
      'permanent Windows file deletion'
    )
    expect(detectBuiltinDestructiveCommand('sc.exe delete MyService')).toBe('system shutdown or service destruction')
  })

  it('resolves commands executed through remote and container wrappers', () => {
    expect(detectBuiltinDestructiveCommand('ssh -p 22 host rm -rf /data')).toBe('permanent file deletion')
    expect(detectBuiltinDestructiveCommand('ssh host "echo rm"')).toBeUndefined()
    expect(detectBuiltinDestructiveCommand('docker exec -it app rm -rf /data')).toBe('permanent file deletion')
    expect(detectBuiltinDestructiveCommand('docker run --rm -v /home/u:/data alpine rm -rf /data/x')).toBe(
      'permanent file deletion'
    )
    expect(detectBuiltinDestructiveCommand('docker run --rm alpine echo rm')).toBeUndefined()
    expect(detectBuiltinDestructiveCommand('kubectl exec -it pod -- rm -rf /data')).toBe('permanent file deletion')
    expect(detectBuiltinDestructiveCommand("su -c 'rm -rf /tmp/x'")).toBe('permanent file deletion')
    expect(detectBuiltinDestructiveCommand('chroot /mnt rm -rf /x')).toBe('permanent file deletion')
  })

  it('does not treat command -v or a bare shell flag as execution', () => {
    expect(detectBuiltinDestructiveCommand('command -v rm')).toBeUndefined()
    expect(detectBuiltinDestructiveCommand('bash -e script.sh')).toBeUndefined()
  })
})

describe('detectBuiltinDestructiveCommand compound commands', () => {
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
    expect(detectBuiltinDestructiveCommand(command)).toBe(reason)
  })

  it('still allows compound bodies that only read or report', () => {
    expect(detectBuiltinDestructiveCommand('if [ -f README.md ]; then echo found; fi')).toBeUndefined()
    expect(detectBuiltinDestructiveCommand('for f in *.md; do echo "$f"; done')).toBeUndefined()
    expect(detectBuiltinDestructiveCommand('while read -r line; do echo "$line"; done < list.txt')).toBeUndefined()
    expect(detectBuiltinDestructiveCommand('{ echo hi; }')).toBeUndefined()
    expect(detectBuiltinDestructiveCommand('case $mode in a) echo a;; esac')).toBeUndefined()
  })
})

describe('detectBuiltinDestructiveCommand heredocs', () => {
  it('analyzes expansions an unquoted heredoc evaluates before its consumer reads it', () => {
    expect(detectBuiltinDestructiveCommand('cat > note <<EOF\n$(rm -f victim)\nEOF')).toBe('permanent file deletion')
    expect(detectBuiltinDestructiveCommand('cat > note <<EOF\n`rm -f victim`\nEOF')).toBe('permanent file deletion')
    expect(detectBuiltinDestructiveCommand('cat > note <<EOF\n$(sh -c "rm -f victim")\nEOF')).toBe(
      'permanent file deletion'
    )
    expect(detectBuiltinDestructiveCommand('cat > note <<EOF\n${payload:-$(rm -f victim)}\nEOF')).toBe(
      'permanent file deletion'
    )
    // Quotes and `#` are literal text in a heredoc body, so neither suppresses the expansion.
    expect(detectBuiltinDestructiveCommand("cat > note <<EOF\n'$(rm -f victim)'\nEOF")).toBe('permanent file deletion')
    expect(detectBuiltinDestructiveCommand('cat > note <<EOF\n# $(rm -f victim)\nEOF')).toBe('permanent file deletion')
  })

  it('leaves a quoted-delimiter heredoc and literal prose inert', () => {
    expect(detectBuiltinDestructiveCommand("cat > note <<'EOF'\n$(rm -f victim)\nEOF")).toBeUndefined()
    expect(detectBuiltinDestructiveCommand('cat > note <<EOF\nrm -rf is dangerous\nEOF')).toBeUndefined()
  })

  it('analyzes SQL a database client reads from stdin', () => {
    expect(detectBuiltinDestructiveCommand("sqlite3 app.db <<'SQL'\nDROP TABLE users;\nSQL")).toBe(
      'destructive database operation'
    )
    expect(detectBuiltinDestructiveCommand("mysql -u root <<'SQL'\ndelete from users;\nSQL")).toBe(
      'destructive database operation'
    )
    expect(detectBuiltinDestructiveCommand("psql -U root <<'SQL'\nTRUNCATE TABLE users;\nSQL")).toBe(
      'destructive database operation'
    )
    expect(detectBuiltinDestructiveCommand('sqlite3 app.db <<< "DROP TABLE users"')).toBe(
      'destructive database operation'
    )
  })

  it('allows read-only SQL on stdin', () => {
    expect(detectBuiltinDestructiveCommand("sqlite3 app.db <<'SQL'\nSELECT * FROM users;\nSQL")).toBeUndefined()
    expect(detectBuiltinDestructiveCommand("echo '.tables' | sqlite3 app.db <<'SQL'\nSELECT 1;\nSQL")).toBeUndefined()
  })
})

describe('detectBuiltinDestructiveCommand executors', () => {
  it('keeps argv intact for executors that do not use a shell', () => {
    expect(detectBuiltinDestructiveCommand('docker exec app python3 -c \'import os; os.remove("victim")\'')).toBe(
      'scripted permanent file deletion'
    )
    expect(detectBuiltinDestructiveCommand("docker exec -u root app sh -c 'rm -rf /data'")).toBe(
      'permanent file deletion'
    )
    expect(detectBuiltinDestructiveCommand('kubectl exec -n ns pod python3 -c \'import os; os.remove("x")\'')).toBe(
      'scripted permanent file deletion'
    )
    expect(detectBuiltinDestructiveCommand('chroot /mnt python3 -c \'import os; os.remove("x")\'')).toBe(
      'scripted permanent file deletion'
    )
    expect(detectBuiltinDestructiveCommand('docker exec app echo rm -rf /x')).toBeUndefined()
    expect(detectBuiltinDestructiveCommand('docker exec -it app ls -la /data')).toBeUndefined()
  })

  it('covers nested docker removal subcommands', () => {
    expect(detectBuiltinDestructiveCommand('docker container rm -f -v app')).toBe(
      'destructive infrastructure operation'
    )
    expect(detectBuiltinDestructiveCommand('docker image rm app')).toBe('destructive infrastructure operation')
    expect(detectBuiltinDestructiveCommand('docker image prune -a')).toBe('destructive infrastructure operation')
    expect(detectBuiltinDestructiveCommand('docker volume prune')).toBe('destructive infrastructure operation')
    expect(detectBuiltinDestructiveCommand('docker network rm bridge')).toBe('destructive infrastructure operation')
    expect(detectBuiltinDestructiveCommand('docker image inspect rm')).toBeUndefined()
    expect(detectBuiltinDestructiveCommand('docker volume create myvol')).toBeUndefined()
  })
})

describe('detectBuiltinDestructiveCommand scripts', () => {
  it('analyzes template-literal interpolations in executed JavaScript', () => {
    expect(
      detectBuiltinDestructiveCommand('node -e \'const fs=require("fs"); console.log(`${fs.unlinkSync("victim")}`)\'')
    ).toBe('scripted permanent file deletion')
    expect(detectBuiltinDestructiveCommand('node -e \'console.log(`${`${require("fs").rmSync("x")}`}`)\'')).toBe(
      'scripted permanent file deletion'
    )
    expect(detectBuiltinDestructiveCommand('node -e \'const o={v:`${fs.rmdirSync("x")}`}; console.log(o)\'')).toBe(
      'scripted permanent file deletion'
    )
    // A brace inside a comment does not close the interpolation.
    expect(detectBuiltinDestructiveCommand('node -e \'console.log(`${/* } */ fs.unlinkSync("victim")}`)\'')).toBe(
      'scripted permanent file deletion'
    )
    expect(detectBuiltinDestructiveCommand('node -e \'console.log(`${ // }\n fs.unlinkSync("victim")}`)\'')).toBe(
      'scripted permanent file deletion'
    )
  })

  it('ignores template-literal text and harmless interpolations', () => {
    expect(detectBuiltinDestructiveCommand('node -e \'console.log(`fs.rmSync("x")`)\'')).toBeUndefined()
    expect(detectBuiltinDestructiveCommand("node -e 'console.log(`a ${{b: 1}.b}`)'")).toBeUndefined()
    expect(detectBuiltinDestructiveCommand('node -e \'const n = "x"; console.log(`file ${n}`)\'')).toBeUndefined()
  })

  it('reads a slash before a character class as a regular expression, not a comment', () => {
    // `/[/*]/` and `/[//]/` hold the comment delimiters inside a class and must not swallow the boundary.
    expect(
      detectBuiltinDestructiveCommand(
        'node -e \'const fs=require("fs"); const x = ${/[/*]/}; fs.unlinkSync("victim")\''
      )
    ).toBe('scripted permanent file deletion')
    expect(
      detectBuiltinDestructiveCommand(
        'node -e \'const fs=require("fs"); const x = ${/[//]/}; fs.unlinkSync("victim")\''
      )
    ).toBe('scripted permanent file deletion')
    expect(
      detectBuiltinDestructiveCommand(
        'node -e \'const fs=require("fs"); console.log(`${/[/*]/}`, `${fs.unlinkSync("victim")}`)\''
      )
    ).toBe('scripted permanent file deletion')
    // A real regex is not prose: what follows it in the same interpolation still runs.
    expect(
      detectBuiltinDestructiveCommand(
        'node -e \'const fs=require("fs"); console.log(`${/a\\/b/.test(x)}`); fs.rmdirSync("victim")\''
      )
    ).toBe('scripted permanent file deletion')
  })

  it('keeps division out of regular-expression scanning', () => {
    expect(detectBuiltinDestructiveCommand("node -e 'const a=6, b=2; console.log(`${a / b}`)'")).toBeUndefined()
    expect(detectBuiltinDestructiveCommand('node -e \'const x="p"; console.log(`${x.length / 2}`)\'')).toBeUndefined()
    // Whitespace before the slash does not make it a regex start; the last token decides. A pair of
    // divisions would otherwise open a scan at the first slash and swallow the deletion between them.
    expect(
      detectBuiltinDestructiveCommand(
        'node -e \'const fs=require("fs"); const a=8 / 2; fs.unlinkSync("victim"); const b=6 / 3;\''
      )
    ).toBe('scripted permanent file deletion')
    expect(
      detectBuiltinDestructiveCommand(
        'node -e \'const fs=require("fs"); const a = 10 / 2; fs.rmdirSync("victim"); const b = 4 / 2;\''
      )
    ).toBe('scripted permanent file deletion')
    // The same pairing inside a template interpolation, where the expression is sliced alone.
    expect(
      detectBuiltinDestructiveCommand(
        'node -e \'const fs=require("fs"); console.log(`${8 / 2}`, `${fs.unlinkSync("victim")}`, `${6 / 3}`)\''
      )
    ).toBe('scripted permanent file deletion')
    // A comment between the operands ends with the character under test, so it has to be skipped
    // rather than treated as the thing being divided.
    expect(
      detectBuiltinDestructiveCommand(
        'node -e \'const fs=require("fs"); const a=8 /* n */ / 2; fs.unlinkSync("victim"); const b=6 / 3;\''
      )
    ).toBe('scripted permanent file deletion')
    expect(
      detectBuiltinDestructiveCommand(
        'node -e \'const fs=require("fs"); const a=8 // n\n / 2; fs.unlinkSync("victim"); const b=6 / 3;\''
      )
    ).toBe('scripted permanent file deletion')
    // A block or object literal closes an expression, so the `/` after it divides.
    expect(
      detectBuiltinDestructiveCommand(
        'node -e \'const fs=require("fs"); const a={} / 2; fs.unlinkSync("victim"); const b=6 / 3;\''
      )
    ).toBe('scripted permanent file deletion')
    // A `//` in a URL string is not a comment, and a comment on an earlier line belongs to that
    // line: only trivia touching the token before the slash may be stepped over.
    expect(
      detectBuiltinDestructiveCommand(
        'node -e \'const fs=require("fs"); const url="https://example.com"; const a=8 / 2; fs.unlinkSync("victim"); const b=6 / 3;\''
      )
    ).toBe('scripted permanent file deletion')
    expect(
      detectBuiltinDestructiveCommand(
        'node -e \'const fs=require("fs"); const a=8;\n// note\nconst b=a / 2; fs.unlinkSync("victim"); const c=b / 4;\''
      )
    ).toBe('scripted permanent file deletion')
  })

  it('does not treat a consumed regular expression as hiding what follows it', () => {
    // A regex whose pattern cannot close before the next slash falls back to division, so the code
    // after it stays visible to the deletion patterns.
    expect(
      detectBuiltinDestructiveCommand('node -e \'const fs=require("fs"); const q = a / b; fs.unlinkSync("victim")\'')
    ).toBe('scripted permanent file deletion')
    expect(
      detectBuiltinDestructiveCommand(
        'node -e \'const fs=require("fs"); const a = b / c; fs.rmSync("victim"); const d = e / f;\''
      )
    ).toBe('scripted permanent file deletion')
  })
})
