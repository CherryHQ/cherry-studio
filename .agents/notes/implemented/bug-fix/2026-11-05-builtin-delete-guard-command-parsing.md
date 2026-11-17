# Agent Note: Match the built-in delete guard on executable commands

Status: implemented

English | [中文](2026-11-05-builtin-delete-guard-command-parsing.zh.md)

## Problem

The protected built-in Agents (Assistant and Support) must never permanently delete data, so `builtin-destructive` denies a Bash call whose command text matches a destructive pattern. The detector matched regular expressions against the entire raw command string, which made text equal to execution: a heredoc that wrote a document mentioning `rm`, the LaTeX flag `-halt-on-error`, the video extension `.rmvb`, a `del` keyword in Python source, or a regex in `rg "del|remove"` all read as deletion.

A four-week audit of Agent sessions found roughly a quarter of the guard's blocks were this kind of false positive. Memory-note appends, document and script creation, LaTeX builds, and read-only scans were denied, while a real deletion written into a script file passed until it was executed.

## Decision

`assistantCommandSafety` now parses the command before deciding. A local tokenizer splits the string into pipelines of simple commands, honouring quotes, escapes, comments, redirections, command substitutions, and heredocs. The guard matches the executable command word and its arguments, never the raw text.

Heredoc bodies are separated from the line that opened them. A body is analyzed only when that line feeds an interpreter that reads standard input (`bash <<'EOF'`, `python3 - <<'PY'`, `cat <<'EOF' | bash`); a heredoc written to a file by `cat`, `tee`, or `printf` is ignored. Interpreter code passed with `-c`/`-e`/`--eval` is analyzed too, and script literals and comments are stripped first so `print("os.remove(x)")` does not count as a call. Nested `$(…)` and backtick substitutions are analyzed recursively, and commands run through `ssh`, `su`, `chroot`, `kubectl exec`, and `docker`/`podman` `exec`/`run` are resolved to their inner command so the wrapper does not hide a deletion.

The command word is resolved through assignments, `sudo`, `xargs`, `env`, `timeout`, and similar wrappers. `halt`, `shutdown`, and `reboot` match only as command words; `-halt-on-error` is an argument. `Remove-Item`, `del`, `sc delete`, and `reg delete` match only in executable position, including through `powershell -Command` (and base64 `-EncodedCommand`) and `cmd /c`.

The denial text now names the built-in Tool Guard, says Cherry Studio enforces it, and states that no settings hook exists to inspect or edit.

## Alternatives considered

- `bash-parser`: a real AST, but the package is at v0.5.0 and pulls twenty Babel-6-era dependencies into the main bundle. The guard needs command boundaries, not a full grammar.
- `shell-quote`: maintained and small, but it is a tokenizer without heredoc support, and it misreads `#` inside a word, `$VAR`, and backticks. The heredoc pre-pass and substitution scan would still be custom, leaving two parsers to reconcile.
- Tightening the regular expressions: heredocs and quoted text have no regular boundary that is cheaper than tokenizing, and patterns that avoid the false positives also miss `bash -c 'rm …'`.
- Blocking `trash`: the guard is about permanent deletion, so the safe move-to-trash path stays allowed.

## Consequences

- The guard decides on structure, so a deletion written into a script file is not blocked until an interpreter executes it — the previous detector had the same blind spot. The guard remains a usability guard, not a security boundary.
- Analysis recurses through at most four levels of `-c`, substitution, and heredoc nesting, which bounds work on adversarial input.
- `git restore --staged` is now allowed because it only unstages; `git restore` without `--staged`, or with `--worktree`, still blocks.
- `fdisk` and similar disk tools remain blocked in read-only forms, preserving the previous behavior.

## Verification

- Regression — `pnpm test:main src/main/ai/agents/builtin/__tests__/assistantCommandSafety.test.ts`: 67 tests; existing true positives stay blocked and the audited false positives (heredoc writers, `-halt-on-error`, `.rmvb`, `del lines[0]`, quoted regexes) are allowed.
- Regression — `pnpm test:main src/main/ai/runtime/claudeCode/__tests__/guardRules.test.ts`: 77 tests; `builtin-destructive` still denies real `rm` in every permission mode and leaves ordinary agents untouched.
- Regression — `pnpm typecheck:node`: main-process types compile.
