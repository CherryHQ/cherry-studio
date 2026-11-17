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
    // Indexed and property assignment targets also evaluate their right-hand side.
    ["pwsh -NoProfile -Command '$a = @(1); $a[0] = del victim.txt'", 'permanent Windows file deletion'],
    ["pwsh -NoProfile -Command '$h = @{}; $h.result = del victim.txt'", 'permanent Windows file deletion'],
    ["pwsh -NoProfile -Command '$a[0] += del victim.txt'", 'permanent Windows file deletion'],
    ["pwsh -NoProfile -Command '$a[$i] = del victim.txt'", 'permanent Windows file deletion'],
    // Braced variables and quoted property targets also evaluate their right-hand side.
    ["pwsh -NoProfile -Command '${output} = del victim.txt'", 'permanent Windows file deletion'],
    ['pwsh -NoProfile -Command \'$h = @{}; $h."result" = del victim.txt\'', 'permanent Windows file deletion'],
    ['pwsh -NoProfile -Command "$h = @{}; $h.\'result\' = del victim.txt"', 'permanent Windows file deletion'],
    ["pwsh -NoProfile -Command '${a}[0] = del victim.txt'", 'permanent Windows file deletion'],
    // Doubled quotes are escaped quote characters inside a quoted property name.
    ['pwsh -NoProfile -Command \'$h = @{}; $h."re""sult" = del victim.txt\'', 'permanent Windows file deletion'],
    ["pwsh -NoProfile -Command \"$h = @{}; $h.'re''sult' = del victim.txt\"", 'permanent Windows file deletion'],
    // Digit-starting and non-ASCII identifiers are valid PowerShell assignment targets too;
    // deny-side coverage is conservative regardless of bare `$1` assignability per shell version.
    ["pwsh -NoProfile -Command '$1 = del victim.txt'", 'permanent Windows file deletion'],
    ['pwsh -NoProfile -Command "$r\u00e9sultat = del victim.txt"', 'permanent Windows file deletion'],
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
    // Bare deletion token closed by an executable terminator: the target arrives from pipeline
    // input, so `del`/`erase`/`rd` followed by `;`, `|`, or `}` keeps the enforced deny.
    ['Get-Item victim.txt | del; Write-Output done', 'permanent Windows file deletion'],
    ['Get-Item victim.txt | del| Out-Null', 'permanent Windows file deletion'],
    ['Get-Item victim.txt | del}', 'permanent Windows file deletion'],
    ['del; Write-Output done', 'permanent Windows file deletion'],
    ['del| Out-Null', 'permanent Windows file deletion'],
    ['del}', 'permanent Windows file deletion'],
    ['Get-Item victim.txt | erase; Write-Output done', 'permanent Windows file deletion'],
    ['Get-Item victim.txt | rd| Out-Null', 'permanent Windows file deletion'],
    ["pwsh -NoProfile -Command 'Get-Item victim.txt | del; Write-Output done'", 'permanent Windows file deletion'],
    // Subexpression close and command-chain separators after the deletion token: the target
    // arrives from pipeline input or the bare token prompts, matching the pre-narrowing guard.
    ['(Get-Item victim.txt | del)', 'permanent Windows file deletion'],
    ["pwsh -NoProfile -Command '(Get-Item victim.txt | del)'", 'permanent Windows file deletion'],
    ['del&&Write-Output done', 'permanent Windows file deletion'],
    ['del&', 'permanent Windows file deletion'],
    ['Get-Item victim.txt | rd)', 'permanent Windows file deletion'],
    ['Get-Item victim.txt | erase&& echo done', 'permanent Windows file deletion'],
    // Foreach collection expression and Get-Command/gcm name-lookup indirection: the
    // collection command runs before the loop body, and a token resolved by the lookup runs
    // when invoked through the call operator. Listing-only spellings over-deny conservatively.
    ['foreach ($i in del victim.txt) {}', 'permanent Windows file deletion'],
    ["pwsh -NoProfile -Command 'foreach ($i in del victim.txt) {}'", 'permanent Windows file deletion'],
    ['foreach ($i in rd victimdir) {}', 'permanent Windows file deletion'],
    ['& (Get-Command -Name del) victim.txt', 'permanent Windows file deletion'],
    ['pwsh -NoProfile -Command "& (Get-Command -Name del) victim.txt"', 'permanent Windows file deletion'],
    ['& (Get-Command -CommandType Alias -Name erase) victim.txt', 'permanent Windows file deletion'],
    // Colon parameter binding: `-Name:del` is equivalent to `-Name del` (the parameter name
    // and value can be separated by a space or a colon), so the lookup keeps the deny.
    ['& (Get-Command -Name:del) victim.txt', 'permanent Windows file deletion'],
    ['& (Get-Command -Name:erase) victim.txt', 'permanent Windows file deletion'],
    ['& (gcm -Name:rd) victimdir', 'permanent Windows file deletion'],
    // Colon-valued options before the name: `-ErrorAction:Stop del` parses the value with
    // the flag (about_Parameters allows space or colon), so the positional name still
    // resolves and the lookup keeps the deny. Long flag runs and long values stay covered
    // with no cap boundary (memoized scanner, not a bounded regex run).
    ['& (Get-Command -ErrorAction:Stop del) victim.txt', 'permanent Windows file deletion'],
    ['& (gcm -CommandType:Alias -Name:del) victim.txt', 'permanent Windows file deletion'],
    ['Get-Command -ListImported:$true del', 'permanent Windows file deletion'],
    ['& (Get-Command -a -b -c -d -e -f -g -h -i del) victim.txt', 'permanent Windows file deletion'],
    [
      '& (Get-Command -Module AVeryLongModuleNameExceedingThirtyTwoCharsIndeed del) victim.txt',
      'permanent Windows file deletion'
    ],
    // Quoted colon-bound names keep the deny; quoted names that merely start with a
    // deletion token stay allowed on the token boundary.
    ['& (Get-Command -Name:"del") victim.txt', 'permanent Windows file deletion'],
    ["& (Get-Command -Name:'erase') victim.txt", 'permanent Windows file deletion'],
    ['& (gcm -All -Name:"rd") victimdir', 'permanent Windows file deletion'],
    // Alias lookups resolve the alias to its destructive target: `gal del` /
    // `Get-Alias -Name erase` invoke Remove-Item through the call operator, so they deny
    // through the same scanner walk (round-26 review finding). The listing-only spelling
    // over-denies conservatively, matching the pre-narrowing guard.
    ['& (Get-Alias del) victim.txt', 'permanent Windows file deletion'],
    ['& (gal del) victim.txt', 'permanent Windows file deletion'],
    ['& (Get-Alias -Name erase) victim.txt', 'permanent Windows file deletion'],
    ["pwsh -NoProfile -Command '& (Get-Alias del) victim.txt'", 'permanent Windows file deletion'],
    ['& (Get-Alias -Name:"rd") victimdir', 'permanent Windows file deletion'],
    // Block comments are stripped before parameter binding, so a comment between a
    // lookup flag and its name still binds the name: `-Name <# ; #> del` binds `del`
    // and the call operator invokes it (round-30 review finding; pwsh 7.4.6 parse-only:
    // the comment token is consumed, the -Name argument is the literal `del`, and the
    // outer command's invocation operator is the ampersand).
    ['& (Get-Command -Name <# ; #> del) victim.txt', 'permanent Windows file deletion'],
    ['& (Get-Alias -Name <# ; #> del) victim.txt', 'permanent Windows file deletion'],
    ["pwsh -NoProfile -Command '& (Get-Command -Name <# ; #> del) victim.txt'", 'permanent Windows file deletion'],
    ['& (gcm -Name <#note#> erase) victim.txt', 'permanent Windows file deletion'],
    // Hashtable entry values execute when the literal evaluates: `@{result = del x}`
    // runs the pipeline assigned to the key. Bare and quoted keys anchor through the
    // scanner; `$`-rooted keys already deny through the assignment family. The scanner
    // is quote-blind like that family, so a quoted value denies too (matching
    // `$x = "del"`) (round-27 review finding).
    ['@{result = del victim.txt}', 'permanent Windows file deletion'],
    ['@{result=del victim.txt}', 'permanent Windows file deletion'],
    ["pwsh -NoProfile -Command '@{result = del victim.txt}'", 'permanent Windows file deletion'],
    ['@{result = erase victim.txt}', 'permanent Windows file deletion'],
    ['@{r = rd victimdir}', 'permanent Windows file deletion'],
    ['@{a=1; result = del victim.txt}', 'permanent Windows file deletion'],
    ['@{a=@{b=del victim.txt}}', 'permanent Windows file deletion'],
    ["@{ 'my key' = del victim.txt }", 'permanent Windows file deletion'],
    ['@{a=(1;2); b=del victim.txt}', 'permanent Windows file deletion'],
    ['@{result = "del"}', 'permanent Windows file deletion'],
    // Bare keys follow the parser's BMP letter/digit boundary: `résultat` and `结果`
    // are valid bare keys, so their entry values execute like `result`'s (round-30
    // review finding; pwsh 7.4.6 parse-only: zero errors, the del command is
    // execution-shaped inside the hashtable, not shielded).
    ['@{résultat = del victim.txt}', 'permanent Windows file deletion'],
    ['@{结果 = del victim.txt}', 'permanent Windows file deletion'],
    ["pwsh -NoProfile -Command '@{résultat = del victim.txt}'", 'permanent Windows file deletion'],
    ['@{$résultat = del victim.txt}', 'permanent Windows file deletion'],
    // A closed quoted value is one opaque segment: separators or braces inside it cannot
    // split the entry, so the later `b` entry still anchors (round-27 residual closure).
    ['@{a=";"; b=del victim.txt}', 'permanent Windows file deletion'],
    ["@{a=';'; b=del victim.txt}", 'permanent Windows file deletion'],
    ['@{a="}"; b=del victim.txt}', 'permanent Windows file deletion'],
    ['@{a=";"; b=@{c=del victim.txt}}', 'permanent Windows file deletion'],
    // Double-quoted values interpolate: a `$` or backtick before the candidate close
    // means it is not the segment end, so those values keep the quote-blind scan.
    ['@{a="$(";")"; b=del victim.txt}', 'permanent Windows file deletion'],
    ['@{k=1; a="$(";")"; b=del victim.txt}', 'permanent Windows file deletion'],
    ['@{a="$(";" + 1)"; b=del victim.txt}', 'permanent Windows file deletion'],
    ['@{a="$x(";")"; b=del victim.txt}', 'permanent Windows file deletion'],
    ['@{a="$(Get-Date)"; b=del victim.txt}', 'permanent Windows file deletion'],
    ['@{a="`"; b=del victim.txt}', 'permanent Windows file deletion'],
    // An unterminated quoted key after an escaped separator must not hide the rest of
    // the table: the frame pops and the nested table still scans.
    ['@{a="`;"; b=@{c=del victim.txt}}', 'permanent Windows file deletion'],
    ['@{k=";"; a="`;"; b=@{c=del victim.txt}}', 'permanent Windows file deletion'],
    // Binding a deletion token as an alias value arms a later bare invocation.
    ['Set-Alias -Name wipe -Value del; wipe victim.txt', 'permanent Windows file deletion'],
    ['Set-Alias wipe del', 'permanent Windows file deletion'],
    ['sal wipe erase', 'permanent Windows file deletion'],
    ['New-Alias wipe rd; rd victimdir', 'permanent Windows file deletion'],
    // A quoted separator inside an alias argument is not a command terminator: the deletion
    // token later in the same command extent still arms the alias.
    ['Set-Alias -Description ";" -Name wipe -Value del; wipe victim.txt', 'permanent Windows file deletion'],
    // A PowerShell block comment never separates commands: `<# note #> del x` deletes.
    ['<# explanation #> del victim.txt', 'permanent Windows file deletion'],
    ['echo ok; <# c #> del victim.txt', 'permanent Windows file deletion'],
    ['<##> del victim.txt', 'permanent Windows file deletion'],
    ['<# a #> <# b #> rd victimdir', 'permanent Windows file deletion'],
    // `&` chains commands like `;` does: comment-blanked `del&&` / `del&` still delete.
    ['Get-Item victim.txt | <# c #> del&& Write-Output done', 'permanent Windows file deletion'],
    ['Get-Item victim.txt | <# c #> del& Write-Output done', 'permanent Windows file deletion'],
    // A quoted delimiter inside a command-prefixed value stays inert; the deletion after it runs.
    ['@{a=Write-Output "}"; b=del victim.txt}', 'permanent Windows file deletion'],
    ['@{a=Write-Output "("; b=del victim.txt}', 'permanent Windows file deletion'],
    ['@{a=Write-Output ";"; b=del victim.txt}', 'permanent Windows file deletion'],
    // A backtick-escaped quote is literal text, never a string boundary; the deletion after
    // the refused segment still executes.
    ['@{a=x""`"; b="}"; c=del x}', 'permanent Windows file deletion'],
    ['echo "@{result = del victim.txt}"', 'permanent Windows file deletion'],
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
    'pwd && ls -la "T:/Some folder del something"',
    'cd "T:/Archivo General" && mkdir -p test && echo "prueba de tanteo del Bibliotecario" > test/file.txt && ls -la test',
    'echo "DEL del Rd erase"',
    'echo @ del is only prose here',
    '@{a="; b=del x"}',
    'Set-Alias -Name delivery -Value Get-ChildItem',
    'Set-Alias -Name ls -Value Get-ChildItem; ls',
    // An unterminated block comment is a syntax error; nothing executes.
    '<# unterminated del victim.txt',
    'git commit -m "docs: mention @ del command form"',
    'git status 2>&1 | head -5',
    'npm test > output.log 2>&1',
    'echo "use 2>nul to hide errors when you delete files"',
    'echo "$x == 5 compares, not assigns"',
    'ls modelo',
    '& (gal delivery) victim.txt',
    '& (Get-Alias -Name delx) victim.txt',
    '@{result = delivery}',
    '@{result = delx}',
    '@{résultat = delivery}',
    '@{结果 = delx}',
    '& (Get-Command -Name <# ; #> delivery) victim.txt',
    '& (Get-Alias -Name <# ; #> delx) victim.txt',
    '@{}',
    'docker container ls -a',
    'docker volume create myvol'
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

  it('stays linear on repeated lookup starts (lookup suffix-rescan regression)', () => {
    // Every `gcm` occurrence used to rescan its suffix in the regex flag run: quadratic.
    // The memoized scanner resolves each position once.
    const probe = 'echo "' + 'gcm -x '.repeat(50_000) + '"'
    expect(probe.length).toBeGreaterThan(300_000)
    const start = performance.now()
    expect(detectDestructiveAssistantCommand(probe)).toBeUndefined()
    // The quadratic form took ~8s here (measured 3.3s at 32k repeats); memoized is a few ms.
    // 2s is generous CI headroom.
    expect(performance.now() - start).toBeLessThan(2000)
    // The colon-valued option form still detects after the memoized walk.
    expect(detectDestructiveAssistantCommand('& (Get-Command -ErrorAction:Stop del) victim.txt)')).toBe(
      'permanent Windows file deletion'
    )
  })

  it('stays linear on overlapping colon-glued lookup anchors (round-26 review finding)', () => {
    // Every `gcm:` repeat is an anchor whose walk never memo-hits: quadratic without O(1)
    // stepping (measured ~17s at 64KB pre-fix); linear is a few ms. 2s is generous CI headroom.
    const probe = 'echo "' + 'gcm:'.repeat(24_000) + 'x"'
    expect(probe.length).toBeGreaterThan(64_000)
    const start = performance.now()
    expect(detectDestructiveAssistantCommand(probe)).toBeUndefined()
    expect(performance.now() - start).toBeLessThan(2000)
    // The alias lookup family still detects after the stepping change.
    expect(detectDestructiveAssistantCommand('& (gal del) victim.txt')).toBe('permanent Windows file deletion')
  })

  it('stays linear on nested and densely keyed hashtable literals (round-27 review finding)', () => {
    // A per-anchor rescan of nested interiors would be quadratic; the frame-stack pass
    // visits each position once.
    const nested = '@{a='.repeat(20_000) + '1' + '}'.repeat(20_000)
    const start = performance.now()
    expect(detectDestructiveAssistantCommand(nested)).toBeUndefined()
    expect(performance.now() - start).toBeLessThan(2000)
    const dense = '@{' + 'k=1;'.repeat(50_000) + '}'
    const start2 = performance.now()
    expect(detectDestructiveAssistantCommand(dense)).toBeUndefined()
    expect(performance.now() - start2).toBeLessThan(2000)
    // The hashtable value family still detects after the pass.
    expect(detectDestructiveAssistantCommand('@{result = del victim.txt}')).toBe('permanent Windows file deletion')
  })

  it('denies deletion behind Unicode bare hashtable keys (round-30 review finding)', () => {
    // The ASCII-only key predicate abandoned the table before examining the executable
    // value; BMP letters and decimal digits continue and start a bare key.
    expect(detectDestructiveAssistantCommand('@{résultat = del victim.txt}')).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand('@{结果 = del victim.txt}')).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand('@{a٥b = del victim.txt}')).toBe('permanent Windows file deletion')
    // Original-input denies are preserved alongside the widened key walk.
    expect(detectDestructiveAssistantCommand('@{result = del victim.txt}')).toBe('permanent Windows file deletion')
    // Benign values behind Unicode keys keep the token boundary.
    expect(detectDestructiveAssistantCommand('@{résultat = delivery}')).toBeUndefined()
  })

  it('denies lookup names split by block comments and preserves raw-input denies (round-30 review finding)', () => {
    // The comment-normalized copy unions with the raw walk: `-Name <# ; #> del` binds `del`.
    expect(detectDestructiveAssistantCommand('& (Get-Command -Name <# ; #> del) victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand('& (Get-Alias -Name <# ; #> rd) victimdir')).toBe(
      'permanent Windows file deletion'
    )
    // Comment text that merely contains a deletion token keeps the raw walk's
    // conservative over-deny: the raw stepping treats comment content as live text
    // (`<# del #>` reads as the name), and the union preserves that original-input deny.
    expect(detectDestructiveAssistantCommand('& (Get-Command -Name <# del #> delivery) victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    // Raw-input denies survive the union unchanged.
    expect(detectDestructiveAssistantCommand('& (Get-Command -Name del) victim.txt <# note #>')).toBe(
      'permanent Windows file deletion'
    )
    // Comment-shaped text inside a quoted echo argument blanks harmlessly: no lookup
    // anchor follows, so the union still allows.
    expect(detectDestructiveAssistantCommand('echo "<# ; #>"')).toBeUndefined()
  })

  it('stays linear on dense Unicode keys and comment-split lookup chains (round-30 review finding)', () => {
    // The widened key predicate stays O(n): every key character is one category test.
    const uniKeys = '@{' + 'résultat=1;'.repeat(20_000) + '}'
    const start = performance.now()
    expect(detectDestructiveAssistantCommand(uniKeys)).toBeUndefined()
    expect(performance.now() - start).toBeLessThan(2000)
    // Dense comment spans ahead of benign lookup values: one blanking pass, one walk.
    const comments = '& (Get-Command -Name ' + '<# x #>'.repeat(10_000) + ' delivery) victim.txt'
    const start2 = performance.now()
    expect(detectDestructiveAssistantCommand(comments)).toBeUndefined()
    expect(performance.now() - start2).toBeLessThan(2000)
    // An unterminated comment swallows the rest in a single jump.
    const open = '& (Get-Command -Name <#' + 'x'.repeat(400_000)
    const start3 = performance.now()
    expect(detectDestructiveAssistantCommand(open)).toBeUndefined()
    expect(performance.now() - start3).toBeLessThan(2000)
    // Both round-30 families still detect after the passes.
    expect(detectDestructiveAssistantCommand('@{résultat = del victim.txt}')).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand('& (Get-Command -Name <# ; #> del) victim.txt')).toBe(
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
  })

  it('stays linear on ambiguous index-assignment scans (alternation overlap regression)', () => {
    // The index segment is one greedy non-bracket run: an alternation between single chars and
    // `$ident` tokens lets `$i`/`$i0` runs partition exponentially (measured 1.9s at 25, >10s at 28).
    const ambiguousOpen = '$a[' + '$i'.repeat(28) + 'foo'
    const ambiguousDigits = '$a[' + '$i0'.repeat(28) + 'foo'
    const closedFailingTail = '$a[' + '$i'.repeat(28) + '] = x'
    const longIdentifier = '$a[$' + 'i'.repeat(4000) + '] = x'
    const start = performance.now()
    expect(detectDestructiveAssistantCommand(ambiguousOpen)).toBeUndefined()
    expect(detectDestructiveAssistantCommand(ambiguousDigits)).toBeUndefined()
    expect(detectDestructiveAssistantCommand(closedFailingTail)).toBeUndefined()
    expect(detectDestructiveAssistantCommand(longIdentifier)).toBeUndefined()
    // Broken ran into exponential backtracking; single-star content is low ms. 2s is generous CI headroom.
    expect(performance.now() - start).toBeLessThan(2000)
  })

  it('keeps denying start through switches and nested anchors (switch-anchor deny coverage)', () => {
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

  it('stays linear on repeated unclosed braced-variable heads (braced-head rescan regression)', () => {
    // `${` opens a braced variable head; when the closing `}` never comes, an unbounded content
    // class rescans the whole remaining suffix from every opener (measured 11/41/135/440ms at
    // 1k/2k/4k/8k openers, quadratic). The content class excludes `{`, so each scan stops at the
    // next opener: literal `{` inside a braced name is the documented tradeoff (same shape as the
    // nested-bracket exclusion in the index chain).
    const input = 'echo "' + '${aaaa'.repeat(32768) + 'x"'
    const start = performance.now()
    expect(detectDestructiveAssistantCommand(input)).toBeUndefined()
    // Unfixed is ~7s here; linear is low ms. 2s is generous CI headroom.
    expect(performance.now() - start).toBeLessThan(2000)
  })

  it('stays linear on repeated quote-glued start tokens (quote-glue anchor rescan regression)', () => {
    // A quote only separates `start` from a preceding token when the quote itself sits at a
    // command position. In `/x\"start` the quote is glued mid-token, so `start` must not anchor -
    // unfixed, every token both anchored the start branch and was consumed as switch arguments by
    // earlier anchors (measured 536/2248/9460ms at 4k/8k/16k, quadratic). The start anchors now
    // reject a glue run (quotes/@/backtick) that is itself preceded by a non-separator.
    const input = "echo '" + '/x"start '.repeat(16000) + "x'"
    const start = performance.now()
    expect(detectDestructiveAssistantCommand(input)).toBeUndefined()
    // Unfixed is ~9.5s here; linear is low ms. 2s is generous CI headroom.
    expect(performance.now() - start).toBeLessThan(2000)
    // Quote-glued start at a real command position still denies.
    expect(detectDestructiveAssistantCommand('cmd /c "start /b del victim.txt"')).toBe(
      'permanent Windows file deletion'
    )
  })

  it('stays linear on long beyond-window glue tokens (all-glue anchor regression)', () => {
    // A `start` buried under 65+ glue characters is never the start command (only one `@` is echo
    // suppression), so it must not anchor: unfixed, each such token anchored and its argument scan
    // re-consumed every later token (measured 387/1312/5357ms at 1k/2k/4k tokens on node 22,
    // quadratic). The fixed-width all-glue lookbehind blocks these anchors at fixed per-position
    // cost on any engine.
    const input = 'echo "' + ('/x' + '@'.repeat(100) + 'start ').repeat(4000) + 'x"'
    const start = performance.now()
    expect(detectDestructiveAssistantCommand(input)).toBeUndefined()
    // Unfixed is ~5s here; linear is low ms. 2s is generous CI headroom.
    expect(performance.now() - start).toBeLessThan(2000)
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
    const backtickStart = 'echo "' + '`start '.repeat(16000) + 'x"'
    // A switch token with a glued @start (`/x@start`) is one argument, not a command: the @ only
    // counts as echo suppression at a command position. Unfixed, each token anchored the start
    // branch (measured 572/2226/8984ms at 4k/8k/16k).
    const gluedSwitchAt = 'echo "' + '/x@start '.repeat(16000) + 'x"'
    const nestedAt = 'start ' + '@start '.repeat(20000) + 'x'
    const backslash = 'start ' + '\\start '.repeat(10000) + 'x'
    const dashed = 'start ' + 'foo-start '.repeat(10000) + 'x'
    const start = performance.now()
    expect(detectDestructiveAssistantCommand(slash)).toBeUndefined()
    expect(detectDestructiveAssistantCommand(atStart)).toBeUndefined()
    expect(detectDestructiveAssistantCommand(nestedAt)).toBeUndefined()
    expect(detectDestructiveAssistantCommand(quoteStart)).toBeUndefined()
    expect(detectDestructiveAssistantCommand(backtickStart)).toBeUndefined()
    expect(detectDestructiveAssistantCommand(gluedSwitchAt)).toBeUndefined()
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

  it('denies deletion after start anchored by 65+ glue runs (scanner-restored anchors)', () => {
    // The {65} lookbehind ban caps the regex window at 64 glue chars; a linear scanner restores
    // the pre-ban anchoring for longer runs, so these command-position forms still deny.
    const runs = ['"'.repeat(65), '"'.repeat(66), '@'.repeat(100), "'".repeat(66), '`'.repeat(66), '@`"'.repeat(22)]
    for (const g of runs) {
      expect(detectDestructiveAssistantCommand(`cmd /c ${g}start /b del victim.txt`)).toBe(
        'permanent Windows file deletion'
      )
    }
    // Wrapped in an echo pair and at string start.
    expect(detectDestructiveAssistantCommand('cmd /c "' + '"'.repeat(66) + 'start /b del victim.txt"')).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand('"'.repeat(66) + 'start /b del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    // A quoted title carrying 65+ glue (with or without an inner `start`) stays a consumable arg.
    expect(detectDestructiveAssistantCommand('cmd /c start "a' + '@'.repeat(70) + '" del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand('cmd /c start "a' + '@'.repeat(70) + 'start /b" del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    // Glue run immediately before a terminal `start` inside the title: argument-tempering the
    // quoted branch would reject the title as an arg and lose this deny.
    expect(detectDestructiveAssistantCommand('cmd /c start "a' + '@'.repeat(70) + 'start" del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    // An args chain after a long-glue anchor still reaches the deletion token.
    expect(detectDestructiveAssistantCommand('cmd /c ' + '"'.repeat(66) + 'start /b /min "title" del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    // No deletion token: allow.
    expect(detectDestructiveAssistantCommand('cmd /c ' + '"'.repeat(66) + 'start notepad.exe')).toBeUndefined()
  })

  it('stays linear on composed long-glue anchor and argument families', () => {
    // Quoted args with inner long-glue starts (word char before the run: not command position),
    // a long-glue command-position anchor followed by both adversarial families, and many
    // command-position long-glue anchors in one input. Unfixed, each family was quadratic.
    const quotedTokens = 'cmd /c start ' + ('"a' + '@'.repeat(100) + 'start /b" ').repeat(4000)
    const composed =
      'cmd /c ' +
      '"'.repeat(66) +
      'start /b del v.txt ' +
      ('"a' + '@'.repeat(100) + 'start /b" ').repeat(2000) +
      "'start ".repeat(2000)
    const manyAnchors = 'cmd /c ' + ('"'.repeat(66) + 'start /b "t" ').repeat(4000) + 'x'
    const start = performance.now()
    expect(detectDestructiveAssistantCommand(quotedTokens)).toBeUndefined()
    expect(detectDestructiveAssistantCommand(composed)).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand(manyAnchors)).toBeUndefined()
    // Measured 20-46ms (node 24) / 66-182ms (node 22) per shape; 2s is generous CI headroom.
    expect(performance.now() - start).toBeLessThan(2000)
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

  it('denies deletion assigned to a PowerShell static property target (round-9 review finding)', () => {
    // Static-property assignment targets ([Type]::Prop =) are assignment-anchored forms, like $x =.
    expect(detectDestructiveAssistantCommand("pwsh -NoProfile -Command '[Console]::Title = del victim.txt'")).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand('[Console]::Title = del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand('pwsh -Command [System.IO.File]::X = del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    // Assignment without a deletion token: allow.
    expect(detectDestructiveAssistantCommand('[Console]::Title = "hello"')).toBeUndefined()
  })

  it('stays linear on repeated quoted start tokens (round-9 review finding)', () => {
    // Each quoted `start` token anchors its own scan; untempered, every anchor's argument walk
    // swallowed the remaining tokens (quadratic: >8s at 8k tokens, now 24-44ms at 16k).
    const repeated = 'echo ' + '"start /b" '.repeat(16000) + 'x'
    const start = performance.now()
    expect(detectDestructiveAssistantCommand(repeated)).toBeUndefined()
    expect(performance.now() - start).toBeLessThan(2000)
    // The single-quote-glued variant stays linear too.
    const singleQuoted = 'echo "' + "'start ".repeat(8000) + 'x"'
    const t2 = performance.now()
    expect(detectDestructiveAssistantCommand(singleQuoted)).toBeUndefined()
    expect(performance.now() - t2).toBeLessThan(2000)
  })

  it('keeps deny coverage when an early anchor swallows quoted start tokens (temper parity locks)', () => {
    // The argument temper refuses quoted `start`+whitespace arguments; the scanner's untempered
    // walk must restore every deny the temper would otherwise drop. These pass on the previous
    // head too: they are coverage locks, not red checks.
    expect(detectDestructiveAssistantCommand('"start /b" "start " arg del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand('start "start " /min /b del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    // A quote-glued `start ` whose closing quote swallows the rest never chained, on any
    // version: both of these stayed allowed on v13/v15/v18 and must stay allowed here.
    expect(detectDestructiveAssistantCommand('"start " arg del victim.txt')).toBeUndefined()
    expect(detectDestructiveAssistantCommand('"start " "start " arg del victim.txt')).toBeUndefined()
  })

  it('denies parenthesized and throw-prefixed deletion forms (round-10 review findings)', () => {
    // The deletion boundary now includes `(` and the executable-prefix list now includes
    // `throw`, matching the other invocation keywords.
    expect(detectDestructiveAssistantCommand('del("victim.txt")')).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand('pwsh -NoProfile -Command \'del("victim.txt")\'')).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand('cmd /c del("victim.txt")')).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand('rd("dir")')).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand('erase("f")')).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand('throw del victim.txt')).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand("pwsh -NoProfile -Command 'throw del victim.txt'")).toBe(
      'permanent Windows file deletion'
    )
    // Word-boundary and spaced-form controls.
    expect(detectDestructiveAssistantCommand('delete victim.txt')).toBeUndefined()
    expect(detectDestructiveAssistantCommand('delimit (x)')).toBeUndefined()
    expect(detectDestructiveAssistantCommand('del victim.txt')).toBe('permanent Windows file deletion')
  })

  it('stays linear on quoted args with embedded word-prefixed start tokens (round-10 review finding)', () => {
    // `a start /b` content is not glue-start-anchored at its first character, so the earlier
    // temper missed it; the generalized temper refuses any quoted argument whose content holds
    // a command-position `start` token followed by whitespace. Was ~2.4s at 8k tokens.
    const repeated = 'echo ' + '"a start /b" '.repeat(16000) + 'x'
    const start = performance.now()
    expect(detectDestructiveAssistantCommand(repeated)).toBeUndefined()
    expect(performance.now() - start).toBeLessThan(2000)
  })

  it('keeps deny coverage on quoted titles containing start tokens (generalized temper locks)', () => {
    // The generalized temper refuses these as arguments; the scanner's untempered walk must
    // still deny every one. All denied on v13/v15/v18/v19 too: coverage locks, not red checks.
    for (const command of [
      'start "my start menu" del victim.txt',
      'cmd /c start "a start /b" del victim.txt',
      'start "start menu" del victim.txt',
      'start "a start " del victim.txt',
      'call "a start /b" del victim.txt',
      'cmd /c "a start /b" del victim.txt'
    ]) {
      expect(detectDestructiveAssistantCommand(command)).toBe('permanent Windows file deletion')
    }
    // xargs-prefix with a quoted title never reached the token on any version: allow lock.
    expect(detectDestructiveAssistantCommand('xargs "my start menu" del victim.txt')).toBeUndefined()
  })

  it('denies exit-prefixed and nested-index-assigned deletion forms (round-11 review findings)', () => {
    // `exit` joins the executable-prefix list alongside throw/call/xargs/... .
    expect(detectDestructiveAssistantCommand('exit del victim.txt')).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand("pwsh -NoProfile -Command 'exit del victim.txt'")).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand('exit rd victim.txt')).toBe('permanent Windows file deletion')
    // Assignment index segments allow one nesting level.
    expect(detectDestructiveAssistantCommand('$a[$b[0]] = del victim.txt')).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand('$a = @(42); $b = @(0); $a[$b[0]] = del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    // Word-boundary and documented-gap controls.
    expect(detectDestructiveAssistantCommand('exitCode del victim.txt')).toBeUndefined()
    expect(detectDestructiveAssistantCommand('existing del victim.txt')).toBeUndefined()
    expect(detectDestructiveAssistantCommand('$a[$b[$c[0]]] = del victim.txt')).toBeUndefined()
    expect(detectDestructiveAssistantCommand('$a[0] = del victim.txt')).toBe('permanent Windows file deletion')
  })

  it('denies parenthesized assignment targets (round-21 review findings)', () => {
    // PowerShell accepts parenthesized roots with member, index or static continuations as
    // assignment LHS; the shipped main guard denies every del-token form of them.
    expect(detectDestructiveAssistantCommand('$h = @{}; ($h).result = del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand('($h).result = del victim.txt')).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand('($a)[0] = del victim.txt')).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand('([Console])::Title = del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand("pwsh -NoProfile -Command '($h).result = del victim.txt'")).toBe(
      'permanent Windows file deletion'
    )
    // One extra nesting level is covered; deeper parenthesization is a documented best-effort gap.
    expect(detectDestructiveAssistantCommand('(($h)).result = del victim.txt')).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand('((($h))).result = del victim.txt')).toBeUndefined()
    // Static chains and scoped variables inside parentheses, and chains after them.
    expect(detectDestructiveAssistantCommand('([Console]::Title) = del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand('($global:t)::x = del victim.txt')).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand('($h).t::Title = del victim.txt')).toBe('permanent Windows file deletion')
    // The parenthesized branch must not start right after a `.`: the documented computed-member
    // gap `$h.($x)` keeps its shipped allow behavior instead of matching its inner `($x)`.
    expect(detectDestructiveAssistantCommand('$h.($x) = del victim.txt')).toBeUndefined()
    // Bare parenthesized variables are valid assignment targets per the official PowerShell
    // 7.6.9 parser (ParseInput AST, parse-only) and deny.
    expect(detectDestructiveAssistantCommand('($h) = del victim.txt')).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand('($5) = del victim.txt')).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand('(($h)) = del victim.txt')).toBe('permanent Windows file deletion')
    // Pinned behavior: the whitespace-separated dot form is a parse error in official
    // PowerShell 7.6.9, so its denial here is conservative noise, not coverage of a valid form.
    expect(detectDestructiveAssistantCommand('$h . ($x) = del victim.txt')).toBe('permanent Windows file deletion')
    // Valid-assignment misses kept as documented best-effort gaps: continuations after an inner
    // parenthesized group, and three or more parenthesization levels (pinned above).
    expect(detectDestructiveAssistantCommand('(($h).x).y = del victim.txt')).toBeUndefined()
    expect(detectDestructiveAssistantCommand('(($a)[0]).x = del victim.txt')).toBeUndefined()
  })

  it('denies scoped and property-rooted static-member assignment chains (round-20 review findings)', () => {
    // Scope-qualified variables and property chains followed by `::Type = <verb>` are real PowerShell
    // assignment targets (the variable carries a typed object; the static call runs the verb's argument
    // as the deletion target).
    expect(detectDestructiveAssistantCommand('$global:t::Title = del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand('$script:t::Title = del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand("pwsh -NoProfile -Command '$local:t::Title = del victim.txt'")).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand('$env:x::Title = del victim.txt')).toBe('permanent Windows file deletion')
    // Property chain rooting: the leading identifier reaches the static member through properties.
    expect(detectDestructiveAssistantCommand('$h.t::Title = del victim.txt')).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand("pwsh -NoProfile -Command '$h.t::Title = del victim.txt'")).toBe(
      'permanent Windows file deletion'
    )
    // A longer identifier is still a plain variable that can carry a typed object.
    expect(detectDestructiveAssistantCommand('$globalx::Title = del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    // A variable glued to a preceding word char still denies, matching the established treatment of
    // variable-rooted static chains shipped in the round-19 repair (deny-side conservatism; the
    // native PowerShell token split for such input is unverified).
    expect(detectDestructiveAssistantCommand('existing $h.t::Title = del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    // The identifier character class excludes Unicode whitespace (nbsp and friends): those codepoints
    // are also matched by the adjacent \s*, and a character class overlapping its neighbour is a
    // quadratic-backtracking vector on long attacker-controlled runs. A whitespace codepoint sitting
    // between the root and `::` is still consumed by \s* and denies conservatively.
    expect(detectDestructiveAssistantCommand('$a ::Title = del victim.txt')).toBe('permanent Windows file deletion')
  })

  it('denies computed-property and ?-identifier assignment forms (round-12 review findings)', () => {
    // Computed member access with a quoted name: $h.("result") - and its quote-escaped content.
    expect(detectDestructiveAssistantCommand('$h.("result") = del victim.txt')).toBe('permanent Windows file deletion')
    expect(
      detectDestructiveAssistantCommand('pwsh -NoProfile -Command \'$h = @{}; $h.("result") = del victim.txt\'')
    ).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand("$h.('result') = del victim.txt")).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand('$h.("a""b") = del victim.txt')).toBe('permanent Windows file deletion')
    // Arbitrary computed expressions stay a documented best-effort gap.
    expect(detectDestructiveAssistantCommand('$h.($x) = del victim.txt')).toBeUndefined()
    // Identifiers may contain ? in any position; execution ordering with a read-only target is
    // unverified, so deny conservatively (the same assumption behind covering $null = ...).
    expect(detectDestructiveAssistantCommand('$a? = del victim.txt')).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand("pwsh -NoProfile -Command '$a? = del victim.txt'")).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand('$x?y = del victim.txt')).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand('$? = del victim.txt')).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand('what? = del victim.txt')).toBeUndefined()
  })

  it('denies ?-tailed scoped identifier assignment forms (round-13 review finding)', () => {
    // Pre-existing parity gap, never covered on any earlier version: scoped identifier tails
    // excluded ? while the bare tail (widened above) accepts it. Same correction shape.
    expect(detectDestructiveAssistantCommand('$global:a? = del victim.txt')).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand("pwsh -NoProfile -Command '$global:a? = del victim.txt'")).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand('$script:a? = del victim.txt')).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand('$private:x? = del victim.txt')).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand('$global:a?b = del victim.txt')).toBe('permanent Windows file deletion')
    // The scoped first character also accepts ? under the same conservative assumption.
    // Existing scoped coverage is unchanged.
    expect(detectDestructiveAssistantCommand('$global:? = del victim.txt')).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand('$global:a = del victim.txt')).toBe('permanent Windows file deletion')
  })

  it('denies quoted static-member assignment forms (round-15 review finding)', () => {
    // Static member access with a quoted name: [Console]::"Title" - mirrors the instance
    // quoted-property coverage, including quote-escaped content. Real gap versus shipped
    // main's broader guard; uncovered on all earlier revisions of this PR.
    expect(detectDestructiveAssistantCommand('[Console]::"Title" = del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand('pwsh -NoProfile -Command \'[Console]::"Title" = del victim.txt\'')).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand("[Console]::'Title' = del victim.txt")).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand('[A]::"a""b" = del victim.txt')).toBe('permanent Windows file deletion')
    // Bare static members stay covered; a quoted member mention without an assignment stays allowed.
    expect(detectDestructiveAssistantCommand('[Console]::Title = del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand('echo [Console]::"Title"')).toBeUndefined()
  })

  it('denies parenthesized quoted static-member assignment forms (round-16 review finding)', () => {
    // Static member access with a parenthesized quoted name: [Console]::("Title") - mirrors
    // the instance parenthesized quoted-property coverage. Real gap versus shipped main's
    // broader guard; uncovered on every earlier revision of this PR (v1-v25).
    expect(detectDestructiveAssistantCommand('[Console]::("Title") = del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    expect(
      detectDestructiveAssistantCommand('pwsh -NoProfile -Command \'[Console]::("Title") = del victim.txt\'')
    ).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand("[Console]::('Title') = del victim.txt")).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand('[A]::("a""b") = del victim.txt')).toBe('permanent Windows file deletion')
  })

  it('denies whitespace-padded member assignment forms (round-18 review finding)', () => {
    // Shipped main's broader guard denies whitespace around the member-access operators and
    // inside the parentheses; earlier revisions of this PR (through v28) allowed them - a real
    // regression versus main. Native execution of every padded form is unverified here; the
    // deny direction conservatively matches main's behavior.
    for (const cmd of [
      '[Console]::( "Title" ) = del victim.txt',
      '[Console]::( "Title") = del victim.txt',
      '[Console]::("Title" ) = del victim.txt',
      '[Console]:: ("Title") = del victim.txt',
      '[Console] ::("Title") = del victim.txt',
      '$h . result = del victim.txt',
      '$h. result = del victim.txt'
    ]) {
      expect(detectDestructiveAssistantCommand(cmd)).toBe('permanent Windows file deletion')
    }
    // Boundary: bare automatic-variable name and unquoted static member access are denied on
    // shipped main and on every revision of this PR by broader rules; kept here as documents.
    expect(detectDestructiveAssistantCommand('$? = del victim.txt')).toBe('permanent Windows file deletion')
    expect(detectDestructiveAssistantCommand('[Console]::"Title" = del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
  })

  it('denies variable-rooted static-member assignment forms (round-19 review finding)', () => {
    // Shipped main's broader guard denies static member access rooted at a variable holding a
    // type literal; every earlier revision of this PR (through v29) allowed them - a real
    // regression versus main. Native execution of each form is unverified here; the deny
    // direction conservatively matches main's behavior.
    for (const cmd of [
      '$t = [Console]; $t::Title = del victim.txt',
      '$t::Title = del victim.txt',
      '$t::"Title" = del victim.txt',
      '$t::("Title") = del victim.txt',
      '$t :: Title = del victim.txt',
      '${t}::Title = del victim.txt',
      '$t::Title . x = del victim.txt'
    ]) {
      expect(detectDestructiveAssistantCommand(cmd)).toBe('permanent Windows file deletion')
    }
    // Boundary: drive-qualified variables and plain assignments stay covered by the pre-existing
    // alternatives; the new static chain must not swallow them differently than main does.
    expect(detectDestructiveAssistantCommand('$env:x = del victim.txt')).toBe('permanent Windows file deletion')
  })

  it('keeps quoted-start temper denies linear with word-glued titles intact (Path A v28)', () => {
    // Embedded command-position start inside a quoted argument still anchors its own scan.
    expect(detectDestructiveAssistantCommand('start "aa start /b" foo del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand('start "' + 'a'.repeat(100) + ' start /b" foo del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    // A start glued to a word inside a title is argument text, not a command: the outer chain
    // still consumes it and the deletion tail denies.
    expect(detectDestructiveAssistantCommand('start "restart job" del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    expect(detectDestructiveAssistantCommand('start "abstart /b" del victim.txt')).toBe(
      'permanent Windows file deletion'
    )
    // Titles that are exactly `start` (no trailing whitespace) still consume as arguments.
    expect(detectDestructiveAssistantCommand('start "start" del victim.txt')).toBe('permanent Windows file deletion')
  })
  // Round 32 (review 5743985195): PowerShell smart-quote classes (CharTraits: doubles
  // U+0022/201C/201D/201E, singles U+0027/2018/2019/201A/201B; U+201F forms nothing),
  // class-pair escapes, spaced/signed cast operands, and line comments before keys.
  describe('round 32: smart quotes, cast operands, and comments in hashtable literals', () => {
    it.each([
      ['& “del” victim.txt', 'permanent Windows file deletion'],
      ['@{“k” = del victim.txt}', 'permanent Windows file deletion'],
      ['@{“a”“b” = 1; x = del victim.txt}', 'permanent Windows file deletion'],
      ['@{“a””b” = 1; x = del victim.txt}', 'permanent Windows file deletion'],
      ['@{“a“”b” = 1; x = del victim.txt}', 'permanent Windows file deletion'],
      ['@{‘a’’b’ = 1; x = del victim.txt}', 'permanent Windows file deletion'],
      ['@{‘a’‘b’ = 1; x = del victim.txt}', 'permanent Windows file deletion'],
      ['@{[int]“1” = 1; x = del victim.txt}', 'permanent Windows file deletion'],
      ['@{[int]“1” = del victim.txt}', 'permanent Windows file deletion'],
      ['@{[string]‘a‘’b’ = del victim.txt}', 'permanent Windows file deletion'],
      ['& „del„ victim.txt', 'permanent Windows file deletion'],
      ['„del„ victim.txt', 'permanent Windows file deletion'],
      ['@{„k„ = del victim.txt}', 'permanent Windows file deletion'],
      ["pwsh -NoProfile -Command '& „del„ victim.txt'", 'permanent Windows file deletion'],
      ['$h.“a“”b” = del victim.txt', 'permanent Windows file deletion'],
      ['$h.“a””b” = del victim.txt', 'permanent Windows file deletion'],
      ['@{a="del" ; x = del victim.txt}', 'permanent Windows file deletion'],
      ['@{ # c\nx = del victim.txt}', 'permanent Windows file deletion'],
      ["pwsh -NoProfile -Command '& “del” victim.txt'", 'permanent Windows file deletion'],
      ["pwsh -NoProfile -Command '& ‘erase’ victim.txt'", 'permanent Windows file deletion'],
      ['“del” victim.txt', 'permanent Windows file deletion'],
      ['x; “del” victim.txt', 'permanent Windows file deletion'],
      ['“del victim.txt”', 'permanent Windows file deletion'],
      ['“del”', 'permanent Windows file deletion'],
      ['& (Get-Command -Name “del”) victim.txt', 'permanent Windows file deletion'],
      ['@{[int] 1 = del victim.txt}', 'permanent Windows file deletion'],
      ['@{[int]-1 = del victim.txt}', 'permanent Windows file deletion'],
      ['@{[int] +1 = del victim.txt}', 'permanent Windows file deletion'],
      ['@{[int] - 1 = del victim.txt}', 'permanent Windows file deletion'],
      ['@{[int][double]1 = del victim.txt}', 'permanent Windows file deletion'],
      ["@{[string] 'a b' = del victim.txt}", 'permanent Windows file deletion'],
      ['@{[int]$x = del victim.txt}', 'permanent Windows file deletion'],
      ['@{[int](1+1) = del victim.txt}', 'permanent Windows file deletion'],
      ['@{ # cleanup\nresult=del victim.txt}', 'permanent Windows file deletion'],
      ['@{#c\nresult=del victim.txt}', 'permanent Windows file deletion'],
      ['@{a=1; # c\nb=del victim.txt}', 'permanent Windows file deletion'],
      ['@{ # c1\n # c2\nresult=del victim.txt}', 'permanent Windows file deletion'],
      ['@{“result” = del victim.txt}', 'permanent Windows file deletion'],
      ['@{a=“del victim.txt”}', 'permanent Windows file deletion']
    ])('denies destructive command: %s', (command, reason) => {
      expect(detectDestructiveAssistantCommand(command)).toBe(reason)
    })

    it.each([
      ['@{“k” = delivery}'],
      ['echo “del victim.txt”'],
      ['@{[int] 1 = delivery}'],
      ['@{[int]-1 = delivery}'],
      ['@{ # cleanup\nresult=1}'],
      ['@{“result” = delivery}'],
      ['echo “delivery”'],
      ['@{[int] 1 = 1}'],
      ['@{a=“delivery”}']
    ])('allows benign command: %s', (command) => {
      expect(detectDestructiveAssistantCommand(command)).toBeUndefined()
    })

    // Every PowerShell quote-class member (CharTraits v7.4.6) must quote in lookup and
    // hashtable-key positions: doubles U+0022/201C/201D/201E, singles U+0027/2018/2019/201A/201B.
    it.each([
      ['& (Get-Command -Name "del") victim.txt', 'permanent Windows file deletion'],
      ['@{"k" = del victim.txt}', 'permanent Windows file deletion'],
      ['& (Get-Command -Name “del“) victim.txt', 'permanent Windows file deletion'],
      ['@{“k“ = del victim.txt}', 'permanent Windows file deletion'],
      ['& (Get-Command -Name ”del”) victim.txt', 'permanent Windows file deletion'],
      ['@{”k” = del victim.txt}', 'permanent Windows file deletion'],
      ['& (Get-Command -Name „del„) victim.txt', 'permanent Windows file deletion'],
      ['@{„k„ = del victim.txt}', 'permanent Windows file deletion'],
      ["& (Get-Command -Name 'del') victim.txt", 'permanent Windows file deletion'],
      ["@{'k' = del victim.txt}", 'permanent Windows file deletion'],
      ['& (Get-Command -Name ‘del‘) victim.txt', 'permanent Windows file deletion'],
      ['@{‘k‘ = del victim.txt}', 'permanent Windows file deletion'],
      ['& (Get-Command -Name ’del’) victim.txt', 'permanent Windows file deletion'],
      ['@{’k’ = del victim.txt}', 'permanent Windows file deletion'],
      ['& (Get-Command -Name ‚del‚) victim.txt', 'permanent Windows file deletion'],
      ['@{‚k‚ = del victim.txt}', 'permanent Windows file deletion'],
      ['& (Get-Command -Name ‛del‛) victim.txt', 'permanent Windows file deletion'],
      ['@{‛k‛ = del victim.txt}', 'permanent Windows file deletion']
    ])('denies class-member lookup/key: %s', (command, reason) => {
      expect(detectDestructiveAssistantCommand(command)).toBe(reason)
    })

    it.each([
      ['& (Get-Command -Name "delivery")'],
      ['& (Get-Command -Name “delivery“)'],
      ['& (Get-Command -Name ”delivery”)'],
      ['& (Get-Command -Name „delivery„)'],
      ["& (Get-Command -Name 'delivery')"],
      ['& (Get-Command -Name ‘delivery‘)'],
      ['& (Get-Command -Name ’delivery’)'],
      ['& (Get-Command -Name ‚delivery‚)'],
      ['& (Get-Command -Name ‛delivery‛)']
    ])('allows benign class-member lookup: %s', (command) => {
      expect(detectDestructiveAssistantCommand(command)).toBeUndefined()
    })

    // Round 33 (review 5744722533): signed numeric keys, line comments inside
    // expression keys, and CR-only comment endings restored main's mandatory denial.
    it.each([
      ['@{-1 = del victim.txt}', 'permanent Windows file deletion'],
      ['@{+1 = del victim.txt}', 'permanent Windows file deletion'],
      ['@{ - 1 = del victim.txt}', 'permanent Windows file deletion'],
      ['@{-1.5 = del victim.txt}', 'permanent Windows file deletion'],
      ['@{1 = del victim.txt}', 'permanent Windows file deletion'],
      ['@{(1 # )\n) = del victim.txt}', 'permanent Windows file deletion'],
      ['@{ # cleanup\rresult=del victim.txt}', 'permanent Windows file deletion'],
      ['@{ # cleanup\r\nresult=del victim.txt}', 'permanent Windows file deletion'],
      ["pwsh -NoProfile -Command '@{-1 = del victim.txt}'", 'permanent Windows file deletion']
    ])('denies destructive command: %s', (command, reason) => {
      expect(detectDestructiveAssistantCommand(command)).toBe(reason)
    })

    it.each([['@{-1 = delivery}'], ['@{(1 # )\n) = delivery}'], ['@{ # cleanup\rresult=1}']])(
      'allows benign command: %s',
      (command) => {
        expect(detectDestructiveAssistantCommand(command)).toBeUndefined()
      }
    )
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
