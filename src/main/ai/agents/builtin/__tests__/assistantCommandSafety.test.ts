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
    ['cmd /c if 1 EQU 1 del /q victim.txt', 'permanent Windows file deletion'],
    ['cmd /c if /i not "a" NEQ "b" erase victim.txt', 'permanent Windows file deletion'],
    ['cmd.exe /c "@del /q victim.txt"', 'permanent Windows file deletion'],
    ['if exist victim.txt @rd /s /q victim.txt', 'permanent Windows file deletion'],
    // Batch `@` echo suppression tolerates whitespace before the command (`@ echo off` is idiomatic),
    // so `@ del` executes the deletion exactly like `@del`.
    ['cmd /c @ del /q victim.txt', 'permanent Windows file deletion'],
    ['cmd.exe /c "@  del /q victim.txt"', 'permanent Windows file deletion'],
    ['cmd /c @\tdel /q victim.txt', 'permanent Windows file deletion'],
    ['echo hi && @ del file.txt', 'permanent Windows file deletion'],
    ['cmd /c if 1 EQU 1 "@ del victim.txt"', 'permanent Windows file deletion'],
    ['if exist victim.txt @ rd /s /q victim.txt', 'permanent Windows file deletion'],
    // cmd accepts repeated @ signs (`@@@@@@@@echo off` runs); mixed @/whitespace runs too.
    ['cmd /c @@del victim.txt', 'permanent Windows file deletion'],
    ['cmd /c @@@@@@@@del victim.txt', 'permanent Windows file deletion'],
    ['cmd /c @@ del victim.txt', 'permanent Windows file deletion'],
    // Conservative deny: `@ "del x"` and `@ @ del` are dubious cmd syntax (not verified executable),
    // but blocking them costs nothing - a denied malformed command only errors - and allowing them
    // would need a full parser. The atomic gap keeps these linear.
    ['cmd /c @ "del victim.txt"', 'permanent Windows file deletion'],
    ['cmd /c @ @ del victim.txt', 'permanent Windows file deletion'],
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
    ['powershell -NoProfile -NonInteractive del victim.txt', 'permanent Windows file deletion'],
    // PowerShell `return` executes its expression, and a scoped assignment target executes its
    // right-hand side - both are real deletion positions the pre-narrowing guard covered.
    ["pwsh -NoProfile -Command 'return del victim.txt'", 'permanent Windows file deletion'],
    ["pwsh -NoProfile -Command '$script:output = del victim.txt'", 'permanent Windows file deletion'],
    // Batch echo suppression applies to any command, including `start` and its arguments.
    ['cmd /c "@start /b del victim.txt"', 'permanent Windows file deletion'],
    ['cmd /c "@@start /min /b del victim.txt"', 'permanent Windows file deletion'],
    // PowerShell invocation positions: dot invocation executes the command, compound and
    // null-coalescing assignments evaluate the right-hand side, and iex/Invoke-Expression
    // execute their argument string.
    ["pwsh -NoProfile -Command '. del victim.txt'", 'permanent Windows file deletion'],
    ["pwsh -NoProfile -Command '$a += del victim.txt'", 'permanent Windows file deletion'],
    ["pwsh -NoProfile -Command '$a ??= del victim.txt'", 'permanent Windows file deletion'],
    ['pwsh -NoProfile -Command "iex \'del victim.txt\'"', 'permanent Windows file deletion'],
    ['pwsh -NoProfile -Command "Invoke-Expression \'del victim.txt\'"', 'permanent Windows file deletion'],
    // Dot invocation still denies at a separator command position, not only after a quote.
    ['pwsh -NoProfile -Command "$x = 1; . del victim.txt"', 'permanent Windows file deletion'],
    ['cmd /c "2>nul del /q victim.txt"', 'permanent Windows file deletion'],
    ['cmd /c >nul del /q victim.txt', 'permanent Windows file deletion'],
    ['cmd /c "1>out.txt 2>&1 del victim.txt"', 'permanent Windows file deletion'],
    ['cmd /c "<nul del victim.txt"', 'permanent Windows file deletion'],
    ['cmd /c "2>nul rd /s /q victimdir"', 'permanent Windows file deletion'],
    ['cmd /c ">>log.txt erase victim.txt"', 'permanent Windows file deletion'],
    ['cmd /c "2>&1 >out.txt del victim.txt"', 'permanent Windows file deletion'],
    ['cmd /c "2> nul del /q victim.txt"', 'permanent Windows file deletion'],
    ['cmd /c "> nul del victim.txt"', 'permanent Windows file deletion'],
    ['cmd /c "1> out.txt 2> &1 del victim.txt"', 'permanent Windows file deletion'],
    ['cmd /c "< nul del victim.txt"', 'permanent Windows file deletion'],
    ['cmd /c "2> nul rd /s /q victimdir"', 'permanent Windows file deletion'],
    ['cmd /c ">a>b 2>&1 del victim.txt"', 'permanent Windows file deletion'],
    ['cmd /c "2> "log file.txt" del victim.txt"', 'permanent Windows file deletion'],
    ['cmd /c "del>nul victim.txt"', 'permanent Windows file deletion'],
    ['cmd /c "rd>>log victimdir"', 'permanent Windows file deletion'],
    ['cmd /c start /b del /q victim.txt', 'permanent Windows file deletion'],
    ['cmd /c start "t" /min del victim.txt', 'permanent Windows file deletion'],
    ['cmd /c start /d C:\\ del victim.txt', 'permanent Windows file deletion'],
    ['cmd /c start start del victim.txt', 'permanent Windows file deletion'],
    ['cmd /c start /b start del victim.txt', 'permanent Windows file deletion'],
    ['start the job and del the files', 'permanent Windows file deletion'],
    ["pwsh -NoProfile -Command '$null = del victim.txt'", 'permanent Windows file deletion'],
    ['$out = erase victim.txt', 'permanent Windows file deletion'],
    ['echo ok\ndel victim.txt', 'permanent Windows file deletion'],
    ['echo ok \n del victim.txt', 'permanent Windows file deletion'],
    ['echo ok\r\n\r\ndel victim.txt', 'permanent Windows file deletion'],
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
    'echo @ del is only prose here',
    'git commit -m "docs: mention @ del command form"',
    'git status 2>&1 | head -5',
    'npm test > output.log 2>&1',
    'echo "use 2>nul to hide errors when you delete files"',
    'echo "$x == 5 compares, not assigns"',
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

  it('stays linear on long whitespace runs before an unquoted deletion tail (suffix ambiguity regression)', () => {
    // The `\s*["']?\s*` suffix let whitespace split across the optional quote: quadratic without a quote.
    const probe = 'echo ok &&' + ' '.repeat(160_000) + 'echo hello'
    const start = performance.now()
    expect(detectDestructiveAssistantCommand(probe)).toBeUndefined()
    // Quadratic took ~11-30s on this input; linear is a few ms. 2s is generous CI headroom.
    expect(performance.now() - start).toBeLessThan(2000)
    // The quote-separated tail form still detects.
    expect(detectDestructiveAssistantCommand('cmd /c   "del /q victim.txt')).toBe('permanent Windows file deletion')
  })

  it('stays linear on long @/quote runs before a non-deletion tail (atomic gap regression)', () => {
    // The `@` whitespace gap must be one atomic scan: alternating @/space or quote/space pairs
    // are the split-ambiguity worst case for a naive `@?\\s*` tail.
    for (const pair of ['@ ', '" ', "@'"]) {
      const probe = 'echo ok && ' + pair.repeat(80_000) + 'echo hello'
      const start = performance.now()
      expect(detectDestructiveAssistantCommand(probe)).toBeUndefined()
      // A split-ambiguity tail is quadratic here; atomic is a few ms. 2s is generous CI headroom.
      expect(performance.now() - start).toBeLessThan(2000)
    }
    // The spaced-@ tail still detects after a long whitespace run.
    expect(detectDestructiveAssistantCommand('cmd /c ' + ' '.repeat(2000) + '@ del /q v.txt')).toBe(
      'permanent Windows file deletion'
    )
  })

  it('blocks redirection targets of any length (no fixed cap)', () => {
    const longName = 'a'.repeat(129)
    const longerName = 'b'.repeat(256)
    expect(detectDestructiveAssistantCommand(`cmd /c "2>${longName} del victim.txt"`)).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand(`cmd /c "2>${longerName} del victim.txt"`)).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand(`cmd /c '2>"${longName}" del victim.txt'`)).toBe(
      'permanent Windows file deletion'
    )
  })

  it('stays linear on redirect chains and trailing whitespace (prefix backtracking regressions)', () => {
    // Unquoted targets must not swallow `>`/`<`/quotes and trailing whitespace must be owned by the
    // atomic gap alone, or redirect chains repartition across the prefix loop exponentially.
    const chain = 'cmd /c "echo ' + '>a'.repeat(100) + ' x"'
    const fdChain = 'cmd /c "' + '2>'.repeat(25) + ' x"'
    const quotedChain = 'cmd /c "echo ' + '>"ab"'.repeat(20) + ' x"'
    const trailing = 'cmd /c "2>nul' + ' '.repeat(20000) + 'x"'
    const start = performance.now()
    expect(detectDestructiveAssistantCommand(chain)).toBeUndefined()
    expect(detectDestructiveAssistantCommand(fdChain)).toBeUndefined()
    expect(detectDestructiveAssistantCommand(quotedChain)).toBeUndefined()
    expect(detectDestructiveAssistantCommand(trailing)).toBeUndefined()
    // Ambiguous v1 shapes took 45ms-18s at k=20 and 1.3s on 40k trailing spaces; unambiguous is sub-ms. 2s is generous CI headroom.
    expect(performance.now() - start).toBeLessThan(2000)
    // The claim rows still detect alongside the probes.
    expect(detectDestructiveAssistantCommand('cmd /c "2>nul del /q victim.txt"')).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand('cmd /c "2> nul del victim.txt"')).toBe('permanent Windows file deletion')
  })

  it('blocks deletions behind more than 8 leading redirects (late-start matching)', () => {
    // The redirect loop is bounded ({1,8}) for linearity; detection must still fire because the
    // unanchored match may begin at any of the last <=8 redirects before the deletion token.
    const nineQuoted = 'cmd /c "' + '>"f" '.repeat(9) + 'del victim.txt"'
    const twentyMixed = 'cmd /c "' + '2>nul '.repeat(20) + 'del victim.txt"'
    expect(detectDestructiveAssistantCommand(nineQuoted)).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand(twentyMixed)).toBe('permanent Windows file deletion')
  })

  it.each([
    `pwsh -NoProfile -Command 'Write-Host "cleanup. erase old files"'`,
    `bash -c 'echo "step 3. del temp"'`,
    'remove it. del / cleanup. erase;'
  ])('does not anchor on a prose sentence period: %s', (input) => {
    expect(detectDestructiveAssistantCommand(input)).toBeUndefined()
  })

  it('stays linear on repeated start anchors (argument rescan regression)', () => {
    // Every `start` word is a command-position anchor; if argument tokens may swallow later
    // `start` words, each anchor rescans the whole remainder: quadratic (436ms at 5000, 1.7s at
    // 10000). Bare values therefore stop at the next `start`, and nested `start start del x`
    // still denies via the innermost anchor.
    const bare = 'start '.repeat(10000) + 'x'
    const withSwitch = 'start /b '.repeat(5000) + 'x'
    const withTitle = 'start "t" '.repeat(5000) + 'x'
    const proseShaped = 'start the job and '.repeat(5000) + 'x'
    const start = performance.now()
    expect(detectDestructiveAssistantCommand(bare)).toBeUndefined()
    expect(detectDestructiveAssistantCommand(withSwitch)).toBeUndefined()
    expect(detectDestructiveAssistantCommand(withTitle)).toBeUndefined()
    expect(detectDestructiveAssistantCommand(proseShaped)).toBeUndefined()
    // Unfixed took 0.4-1.8s each here; linear is low ms. 2s is generous CI headroom.
    expect(performance.now() - start).toBeLessThan(2000)
    // Nested start still denies through the innermost anchor.
    expect(detectDestructiveAssistantCommand('cmd /c start start del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    // Echo-suppressed start with arguments still denies, including nested through a plain start.
    expect(detectDestructiveAssistantCommand('cmd /c "@start /b del victim.txt"')).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand('cmd /c start @start /b del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    // A quote-prefixed start keeps its own anchor (it is not swallowed as an argument).
    expect(detectDestructiveAssistantCommand(`cmd /c "'start /b del victim.txt'"`)).toBe(
      'permanent Windows file deletion'
    )
  })

  it('stays linear on large newline runs and mixed gap runs (separator restart regression)', () => {
    // Newlines are command separators, so every newline in a run used to restart a maximal gap
    // rescan: quadratic on the main thread (631ms at 20k, 2.5s at 40k). Only the first newline of
    // a gap run may start a match.
    const homogeneous = 'echo ok &&' + '\n'.repeat(20000) + 'echo hello'
    const alternating = 'echo ok &&' + '\n '.repeat(20000) + 'echo hello'
    const crlf = 'echo ok &&' + '\r\n'.repeat(20000) + 'echo hello'
    const mixed = 'echo ok &&' + '" \n@'.repeat(10000) + 'echo hello'
    const start = performance.now()
    expect(detectDestructiveAssistantCommand(homogeneous)).toBeUndefined()
    expect(detectDestructiveAssistantCommand(alternating)).toBeUndefined()
    expect(detectDestructiveAssistantCommand(crlf)).toBeUndefined()
    expect(detectDestructiveAssistantCommand(mixed)).toBeUndefined()
    // Unfixed runs took 0.6-2.6s each here; linear is low ms. 2s is generous CI headroom.
    expect(performance.now() - start).toBeLessThan(2000)
    // Newline-separated deletions still detect.
    expect(detectDestructiveAssistantCommand('echo ok\ndel victim.txt')).toBe('permanent Windows file deletion')
  })

  it('stays linear on long failing redirect chains with separators (unanchored rescan regression)', () => {
    // Each redirect start used to rescan the whole remaining chain on overall mismatch: quadratic.
    const quotedChain = 'cmd /c "' + '>"a" '.repeat(5000) + ' x"'
    const unquotedChain = 'cmd /c "' + '>a '.repeat(5000) + ' x"'
    const fdChain = 'cmd /c "' + '2>a '.repeat(5000) + ' x"'
    const start = performance.now()
    expect(detectDestructiveAssistantCommand(quotedChain)).toBeUndefined()
    expect(detectDestructiveAssistantCommand(unquotedChain)).toBeUndefined()
    expect(detectDestructiveAssistantCommand(fdChain)).toBeUndefined()
    // Unbounded loop took 330ms at 5000 and 5.3s at 20000 here; bounded is ~1-5ms. 2s is generous CI headroom.
    expect(performance.now() - start).toBeLessThan(2000)
  })

  it('stays linear on launcher flags separated by long whitespace runs (empty-value ambiguity regression)', () => {
    // The optional launcher flag value could match empty, letting a whitespace run split across the
    // inner value gap and the next flag gap: quadratic-to-worse backtracking on the main thread.
    const probe =
      'powershell ' +
      ['-NoLogo', '-NoExit', '-Sta', '-NoProfile', '-NonInteractive'].join(' '.repeat(80)) +
      ' echo hello'
    const start = performance.now()
    expect(detectDestructiveAssistantCommand(probe)).toBeUndefined()
    // Ambiguous partitioning took ~10-15s on this input; unambiguous is a fraction of a ms. 2s is generous CI headroom.
    expect(performance.now() - start).toBeLessThan(2000)
    // The launcher forms still detect, with and without flag values.
    expect(detectDestructiveAssistantCommand('powershell -nop -ep bypass del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand('powershell -NoProfile del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
  })

  it('blocks true CMD equalities with 257+ char unquoted operands (base parity)', () => {
    // The pre-narrowing guard blocked these; the earlier 256-char cap dropped them. The left
    // operand now excludes `=` instead of capping length, so valid long literals deny again.
    const a257 = 'a'.repeat(257)
    expect(detectDestructiveAssistantCommand(`if ${a257}==${a257} del victim.txt`)).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand(`if ${'x'.repeat(300)}==y del victim.txt`)).toBe(
      'permanent Windows file deletion'
    )
  })

  it('stays linear on failing equality runs (operand repartition regression)', () => {
    // Letting unquoted operands cross `==` boundaries makes every boundary a candidate split and
    // rescans the remainder per split: quadratic. The left operand cannot cross `==`, so each
    // position has exactly one parse.
    const chain = 'if ' + 'a=='.repeat(40000) + 'b x'
    const many = 'echo "' + ('if ' + 'q'.repeat(60) + '==r ').repeat(6000) + '"'
    const start = performance.now()
    expect(detectDestructiveAssistantCommand(chain)).toBeUndefined()
    expect(detectDestructiveAssistantCommand(many)).toBeUndefined()
    // Naive unbounded operands are quadratic here; bounded is low ms. 2s is generous CI headroom.
    expect(performance.now() - start).toBeLessThan(2000)
  })

  it('stays linear on repeated switch-glued start tokens (switch-anchor rescan regression)', () => {
    // `/start` is a switch-shaped token, not the start command - but it both anchored the
    // start-arguments branch and was consumed as a switch argument by earlier anchors, so every
    // token restarted an argument scan over the remainder (measured 238/953/3772ms at 4k/8k/16k).
    // The start-arguments anchor now requires command position (whitespace, separator or quote
    // before it), so argument-glued `start` tokens no longer anchor it.
    const slash = 'echo "' + '/start '.repeat(16000) + 'x"'
    const atStart = 'echo "' + '@start '.repeat(20000) + 'x"'
    const quoteStart = 'echo "' + "'start ".repeat(16000) + 'x"'
    const nestedAt = 'start ' + '@start '.repeat(20000) + 'x'
    const backslash = 'start ' + '\\start '.repeat(10000) + 'x'
    const dashed = 'start ' + 'foo-start '.repeat(10000) + 'x'
    const start = performance.now()
    expect(detectDestructiveAssistantCommand(slash)).toBeUndefined()
    expect(detectDestructiveAssistantCommand(atStart)).toBeUndefined()
    expect(detectDestructiveAssistantCommand(nestedAt)).toBeUndefined()
    expect(detectDestructiveAssistantCommand(quoteStart)).toBeUndefined()
    expect(detectDestructiveAssistantCommand(backslash)).toBeUndefined()
    expect(detectDestructiveAssistantCommand(dashed)).toBeUndefined()
    // Unfixed took 2.5-7.8s per shape here; linear is low ms. 2s is generous CI headroom.
    expect(performance.now() - start).toBeLessThan(2000)
    // Real start forms still deny: switches, titles, and nested starts.
    expect(detectDestructiveAssistantCommand('cmd /c start /b del victim.txt')).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand('cmd /c start "t" /min del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand('cmd /c start start del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
  })

  it('keeps the pre-existing unbounded bare operand (257+ chars still blocked)', () => {
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
