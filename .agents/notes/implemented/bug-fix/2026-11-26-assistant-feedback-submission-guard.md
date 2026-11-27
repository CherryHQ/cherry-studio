# Agent Note: Resolve the Assistant feedback-submission guard through the command parser

Status: implemented

English | [中文](2026-11-26-assistant-feedback-submission-guard.zh.md)

## Problem

The built-in Assistant may submit Cherry Studio feedback under the user's identity through `gh issue create` or `lark-cli base +form-submit`. The `assistant-feedback` guard asks for live per-call approval and denies the submission on headless turns. It matched two regular expressions against the raw command text and applied only to the Claude Code `Bash` tool. Running the same command another way skipped the approval, for example:

- options before the subcommand (`gh -R repo issue create`)
- the `gh issue new` alias
- wrappers such as `env`, `sudo`, `nohup` and `xargs`
- nested shells: `bash -c`, `$(…)`, loops and heredocs
- a dynamic subcommand
- `gh api` issue creation
- code passed to an interpreter with `-c` or `-e`
- the Claude Code `PowerShell` tool

The Support role's `support-bash` rule, which asks for every shell call, also matched only `Bash`.

## Decision

The guard asks the shared command policy which commands an invocation runs and makes its own decision from those commands. The `commandPolicy` barrel exports `resolveInvocationCommands`, which returns every resolved command and whether any part stayed unresolved. That export makes no policy decision. [Guard](../../../../src/main/ai/agents/builtin/assistantCommandSafety.ts) · [Resolver](../../../../src/main/ai/toolApproval/commandPolicy/policyEvaluator.ts)

A resolved command counts as a submission when one of these holds:

- Its executable is `gh` or `lark-cli` and the action follows the group. A word between them may only be the value of an option, because option arities are unknown. A dynamic word matches anything.
- It is `gh api` with a write method (explicit, or implied by fields or `--input`) aimed at a `repos/*/*/issues` endpoint, a dynamic endpoint, or an uninspectable `graphql` mutation.
- It is a non-shell interpreter whose inline code names `gh` or `lark-cli`.

Executable names compare case-insensitively without `.exe`, because Git Bash and Pi's PowerShell, which reaches the guard as `Bash`, resolve them that way on Windows. An unresolved part fails closed when the raw text names a submitter, and a thrown check requires approval.

The guard resolves its dialect from both the Claude Code `Bash` and `PowerShell` tool names, and `support-bash` asks for both. [Rules](../../../../src/main/ai/agents/builtin/builtinAgentGuardRules.ts)

## Alternatives considered

- Extending the regular expressions: every wrapper, option order and nesting form needs another pattern. The command policy already parses those forms for both dialects.
- Asking for every Assistant shell call, as Support does: this covers every form, but the Assistant runs shell commands routinely and would prompt constantly.
- An OS sandbox with a network allowlist, as Claude Code and Codex use: it would also cover script files. It allows by domain rather than by call, though, so it cannot replace per-call approval of a submission. It is not adopted yet.
- Moving the detection into the JSON command policy: that policy asks only in `auto`. This guard must ask in every interactive mode and deny on headless turns.

## Consequences

- The guard is still a usability guard, not a security boundary. A submission written into a script file (`python3 submit.py`) or made through `lark-cli api` is not detected.
- The fail-closed paths ask for some non-submissions, for example inline Python that prints the word `gh`, or `gh issue --flag value create` forms that a known arity would rule out.
- The Assistant guard depends on the command policy's parser. A parser change that resolves a form differently changes this guard too, and the shared tests cover both.

## Verification

- Regression — `npx vitest run src/main/ai/agents/builtin/__tests__/assistantCommandSafety.test.ts`: the submission cases above, including uppercase `GH`/`GH.EXE`, PowerShell, `gh api` and inline interpreter code. Each new case failed before its fix. Reads such as `gh issue list --label create`, a GET `gh api` call, issue comments and read-only GraphQL stay allowed.
- Regression — `npx vitest run src/main/ai/runtime/claudeCode/__tests__/guardRules.test.ts`: `assistant-feedback` asks on the `PowerShell` tool, and `support-bash` asks on interactive `PowerShell` calls and denies headless ones. Both PowerShell cases failed before the rule change.
- Regression — `npx vitest run src/main/ai/runtime/pi/piApprovalFacts.test.ts src/main/ai/toolApproval/commandPolicy/__tests__/policyEvaluator.test.ts`: the Pi caller and the shared evaluator are unchanged.
