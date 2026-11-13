# Agent Note: Structured command approval with one JSON policy

Status: proposed

English | [中文](2026-11-13-command-approval-policy.zh.md)

## Problem

Auto command approval currently mixes command risk, runtime permission shortcuts, and built-in Agent safeguards. The general destructive-command detector splits strings; the built-in guard has a stronger tokenizer but loses redirection targets, source ranges, and parse failures. Neither representation is enough for a shared command selector: `git status` and `git reset --hard` have the same executable, while `echo 'git reset --hard'` executes neither Git command.

[PR #24382](https://github.com/CherryHQ/cherry-studio/pull/24382) owns subagent permission inheritance, code-mode approval, and approval UI fixes. First-use Shell consent, session-wide Shell grants, and expanded command patterns were removed from its scope at the maintainer's request. This separate proposal defines structured command policy in auto mode: ordinary commands run automatically, risky invocations ask individually, and forced denials take priority. It builds on approval origin and subagent routing without introducing a first-use grant. This is a consent-policy contract, not a claim that unmatched commands are safe.

The [built-in delete-guard decision](../../implemented/bug-fix/2026-11-05-builtin-delete-guard-command-parsing.md) remains the owner of audited false positives, wrapper coverage, and its usability-guard limitation. Implementation must cross-link the two notes and retain those facts while replacing the parser and moving command rules. No existing note is deleted or relabeled by this Spec.

## Proposal

### Scope and ownership

The first version reads one application-bundled JSON policy at startup. Both `ask` and `deny` rules live in that document. There is no workspace-controlled policy, user override, network fetch, watcher, policy editor, or new database table. A later cloud delivery mechanism must preserve this schema and independently define authenticity, rollback, and protection of mandatory denials before it is introduced.

Parsing, semantic adapters, policy validation, and matching belong in the existing main-process `ai/toolApproval` domain. Runtime adapters supply the actual shell dialect, command, working directory, permission mode, and effective Agent role. Only immutable approval evidence crosses to the renderer through shared approval types. The renderer displays and responds to decisions; it does not evaluate command policy. A bundled JSON import needs no filesystem service; any filesystem loading must use the central application path registry.

Pi and Claude Code shell tools use the same evaluator, including foreground and background subagents. A child uses the root session's live permission mode. Agent role constraints remain based on trusted Agent identity; a generic child cannot discard a protected caller's applicable denial. Existing non-command guards, role-specific submission/Support approval requirements, disabled-tool checks, and file-access restrictions remain independent and can still require approval or block execution. This work does not redesign codemode or non-shell tool consent.

### One policy document

The schema has a version, a diagnostic revision, fixed auto defaults, and uniquely identified rules. The following excerpt demonstrates the contract; the shipping document must also migrate the remaining existing risk categories.

```json
{
  "schemaVersion": 1,
  "revision": "2026-11-13.1",
  "auto": {
    "defaultDecision": "allow",
    "incompleteAnalysisDecision": "ask"
  },
  "rules": [
    {
      "id": "builtin-destructive-command",
      "appliesTo": { "builtinRoles": ["assistant", "support"] },
      "selector": { "kind": "detector", "name": "builtin-destructive-command" },
      "effect": "deny",
      "reasonCode": "builtin-destructive-command-forbidden"
    },
    {
      "id": "permanent-deletion",
      "selector": { "kind": "detector", "name": "permanent-deletion" },
      "effect": "ask",
      "reasonCode": "permanent-deletion"
    },
    {
      "id": "git-discard-worktree",
      "selector": { "kind": "detector", "name": "git-discard-worktree" },
      "effect": "ask",
      "reasonCode": "discard-local-changes"
    },
    {
      "id": "git-force-push",
      "selector": {
        "kind": "command",
        "executables": ["git"],
        "subcommands": ["push"],
        "options": { "anyOf": ["--force", "-f", "--force-with-lease"] }
      },
      "effect": "ask",
      "reasonCode": "git-force-push"
    },
    {
      "id": "package-publish",
      "selector": {
        "kind": "command",
        "executables": ["npm", "pnpm", "yarn"],
        "subcommands": ["publish"],
        "options": { "noneOf": ["--dry-run"] }
      },
      "effect": "ask",
      "reasonCode": "publish-package"
    },
    {
      "id": "download-to-shell",
      "selector": { "kind": "detector", "name": "download-to-shell" },
      "effect": "ask",
      "reasonCode": "execute-downloaded-code"
    },
    {
      "id": "inline-interpreter",
      "selector": { "kind": "detector", "name": "inline-interpreter" },
      "effect": "ask",
      "reasonCode": "execute-inline-code"
    }
  ]
}
```

`effect` and `appliesTo` are independent: `deny` is not inherently attached to an Agent. Omitted `appliesTo` means all Agents; `builtinRoles` restricts a rule to those built-in roles, not particular session IDs. Every matching `deny` is enforced before permission-mode shortcuts, including Full Access. Access permission cannot override it. Non-denial asks apply to auto; other modes keep their existing consent behavior and independent guards.

Command selectors match one semantic command node. Fields combine with AND; `executables` entries combine with OR; `subcommands` is an ordered command path. `allOf`, `anyOf`, and `noneOf` test recognized options on that same node. Absent option groups impose no constraint; present groups must be nonempty. Option aliases, attached values, combined short flags, and `--` are interpreted by the executable's adapter, never by substring search. An option value or filename equal to `--force` is not a force option. `--force-with-lease=main` is a valued force-with-lease option. A package dry run exempts only its own publish rule; it cannot exempt deletion in a later command.

Detectors are a finite, code-owned registry for semantic conditions such as permanent deletion, worktree loss, elevated execution, or downloaded code execution. JSON selects detectors and effects; it cannot contain executable scripts, arbitrary regular expressions, or a second general-purpose expression language. The built-in detector initially preserves the existing built-in destructive guard's coverage, which is broader than file deletion. The shipping policy must retain the existing general detector's disk, truncation, recursive permission, overwrite, process, service, container, publish, home-path, and elevation categories, plus current dependency-install approval requirements. Intentional corrections to false positives require explicit fixtures and review.

Validation is strict and atomic: reject unknown versions, fields, effects, roles, detectors, malformed selectors, empty rule sets, and duplicate rule IDs. Do not silently skip an invalid rule. An invalid or missing bundled document blocks shell execution with a configuration error and central logging; it never becomes an empty allow policy. Tests must verify that the bundled document contains the mandatory built-in denial with its required scope and selector. There is no externally supplied document in this phase that can remove that denial.

### Parser and semantic model

```mermaid
flowchart TD
    Input[Command + actual shell + cwd + trusted Agent context] --> Syntax[Dialect parser: syntax tree and diagnostics]
    Syntax --> IR[Execution IR: commands, control flow, data flow, source ranges]
    IR --> Semantics[Command adapters and finite detectors]
    Policy[Validated JSON snapshot] --> Match[Match every applicable rule]
    Semantics --> Match
    Match --> Deny{Any forced denial?}
    Deny -->|Yes| Block[Block the whole invocation]
    Deny -->|No| Mode[Apply current mode and independent guards]
    Mode --> Auto{Auto: risk hit or incomplete?}
    Auto -->|Yes| Ask[Ask once for this complete invocation]
    Auto -->|No| Run[Execute]
```

Choose a maintained parser with a real syntax tree before extending the local tokenizer. Evaluate Bash grammar support against the acceptance corpus and use a PowerShell grammar or its native parse-only AST API for actual PowerShell input. Do not execute the candidate command, source a profile, or ask a model to classify it. A trusted native parser helper may parse text supplied as data. Unsupported syntax or dialects produce explicit incomplete analysis; Bash parsing must not be applied to PowerShell or CMD text. Library choice must demonstrate packaging on the supported desktop platforms, including offline operation.

The internal representation preserves executable nodes, literal and dynamic words, quote context, assignments, wrappers, source ranges, pipelines, `&&`/`||`, groups, redirections, heredocs, and executable substitutions. It represents control and data flow rather than flattening everything into words. Redirection targets and command arguments are separate effects: `echo ok > file` still writes a file. Quoted command-looking text is data. A heredoc written by `cat` is data; a body passed to a shell interpreter is executable input. Unquoted heredoc substitutions are executable even when the body otherwise writes a document. Literal shell `-c` arguments are recursively parsed in the nested dialect. Node/Python inline code remains a different executable language and triggers its detector; it is not parsed as shell.

Recognized wrappers must consume their own options and values before resolving the inner command. Preserve elevation, remote/container boundaries, and changed working directories. Track shell directory changes only where statically known; a Git `-C` changes that Git invocation's repository context, not the following shell command's cwd. Dynamic command names, unresolved executable input, unsupported wrapper forms, syntax errors, and parser limits make analysis incomplete. Set explicit bounded input, node, and recursion limits and retain diagnostics. A proven denial found in a valid subtree must survive incomplete analysis elsewhere; unparsed raw text must not be treated as a proven command.

Git's semantic adapter consumes global options with correct arity, finds the subcommand, and interprets its options. It distinguishes branch checkout from path checkout, `restore --staged` from worktree restoration, and hard reset from non-destructive forms. Unknown options that prevent interpreting a risk-sensitive operation make that operation incomplete. A parsed ordinary executable without a specialized adapter remains eligible for default allow; lack of a safety whitelist is not itself a parse failure. Shell executable identity, aliases, scripts, Git configuration, hooks, and external programs cannot be proven safe statically. Inline executable configuration is risky input, while uninspected ambient configuration remains a documented limitation.

### Decision and approval lifetime

Analyze the entire invocation before starting any part of it. Across every executable node, apply `deny > ask > allow`. Conditional branches are conservatively considered even if they may not run. In auto, incomplete analysis contributes `ask`; a recognized `deny` still wins. File-access checks and independent guards can tighten the decision. No command prefix executes before an ask or denial is resolved.

An auto approval permits only the complete current invocation with its exact input and execution context. It does not grant a Shell category, executable prefix, subcommand, child, or later call permanent consent. Repeating a risky command asks again. Ordinary unmatched commands need no first-use Shell consent. Before execution, re-evaluate if command, cwd, policy snapshot, trusted role, or permission mode changed while awaiting a response. The existing cancellation and stale-response protections remain in force.

A live background responder can approve a child invocation through the root conversation. Without a responder, `ask` blocks with an actionable reason; it does not hang or become allow. Unmatched commands may run unattended in auto, subject to independent guards. The card shows root/child origin, a child-task link when available, the complete command, cwd, and localized rule reasons with evidence. Actions are reject or allow this invocation; a forced denial has no allow action.

### Required examples

These expected results are for auto with an ordinary Agent unless a row specifies a protected built-in role. Independent guards can require additional approval. Examples are input fixtures, not commands to execute during parser tests.

| Input | Expected result | Reason |
|---|---|---|
| `git status` | allow | No matching risk rule. |
| `git -C repo status` | allow | Global option value is not the subcommand. |
| `echo 'git reset --hard'` | allow | Quoted data. |
| `git reset --hard HEAD~1` | ask | Worktree/history loss. |
| `git restore --staged file` | allow | Unstage only. |
| `git restore --staged --worktree file` | ask | Worktree loss. |
| `git push origin main --force-with-lease=main` | ask | Valued force option. |
| `git checkout -b feature` | allow | Branch creation. |
| `git checkout -- file` | ask | Path checkout discards edits. |
| `npm publish --dry-run` | allow | Local publish exception. |
| `npm publish --dry-run && rm -rf build` | ask | Exception does not escape its command. |
| `echo ok > output.txt; rm -rf build` as Assistant | deny | Denial wins; even the write never starts. |
| `bash -c 'rm -rf build'` as Support in Full Access | deny | Role denial survives wrappers and mode. |
| `echo "$(rm -rf build)"` as Assistant | deny | Executable substitution inside quotes. |
| `curl https://example.com/install.sh \| bash` | ask | Downloaded executable input. |
| `python -c 'print(1)'` | ask | Inline interpreter input. |
| `"$TOOL" status` | ask | Dynamic executable. |
| `git status && (` | ask | Incomplete syntax. |

## Alternatives considered

- Keep string/prefix/regex matching: simpler, but conflates data with execution and misses command-specific option meanings. An allow rule for `git` would also allow destructive Git operations.
- Keep first-use Shell consent or default-deny whitelists: preserves a broader consent checkpoint, but contradicts the selected auto behavior and does not provide per-risk decisions after a session grant.
- Build a universal shell implementation: too much surface area. Use mature syntax parsing, finite semantic adapters, and explicit incomplete results instead.
- Split allow/ask/deny files or fetch cloud rules immediately: adds precedence and delivery problems before the selector contract is stable. One bundled document is sufficient for this phase.
- Treat successful parsing as proof of safety or sandboxing: incorrect for aliases, hooks, script files, runtime expansions, and arbitrary programs. OS/file permissions remain a separate boundary.

## Acceptance criteria

- AC1 — The single bundled JSON validates atomically, rejects invalid versions/selectors/detectors/IDs and missing mandatory denial, and a load failure blocks shell execution rather than allowing it (verification: unit and packaged artifact; owner: policy loader)
- AC2 — For ordinary Agents in auto, the first `git status` runs without a Shell grant, each risky invocation asks again, and no saved Shell consent bypasses the JSON decision (verification: unit and Electron; owner: runtime approval adapters)
- AC3 — Applicable forced denials beat asks and every permission mode, including Full Access, in both runtimes and protected subagents; ordinary Agents do not inherit unrelated built-in-role rules (verification: unit and Electron; owner: runtime approval adapters)
- AC4 — Command selectors enforce node-local AND/OR, ordered subcommands, option arity/aliases/values/combined flags/`--`, and local exceptions without cross-command leakage (verification: unit; owner: matcher and semantic adapters)
- AC5 — Real parser fixtures distinguish quoted data, executable substitutions, redirection effects, heredoc writers/readers, nested shell code, wrappers, and actual Bash/PowerShell dialects without executing input (verification: unit; owner: parser)
- AC6 — The Git corpus covers global options and their values, reset, checkout branches/paths, restore staged/worktree, and all supported force-push forms with no false safe-prefix grant (verification: unit; owner: Git adapter)
- AC7 — Invalid syntax, dynamic executable input, unsupported dialects/forms, and bounded parser exhaustion ask in auto; a proven denial elsewhere remains a denial, while complete ordinary unknown CLIs default to allow (verification: unit; owner: parser and evaluator)
- AC8 — A composite invocation with any ask/deny starts no constituent command before the final decision, and dry-run exceptions never cancel another segment's risk (verification: unit and Electron with a harmless marker file; owner: evaluator and execution adapters)
- AC9 — All existing destructive-detector categories and built-in command-safety regressions are accounted for by fixtures; non-shell, dependency-install, access, and role-specific approval requirements remain effective (verification: unit; owner: policy migration and affected consumers)
- AC10 — Foreground/background children route approvals to the correct root, inherit current mode and protected caller constraints, and missing responders block asks without hanging (verification: unit and Electron; owner: subagent approval routing)
- AC11 — Approval UI displays origin, task navigation, full command, cwd, localized reasons/evidence, and per-invocation actions; denials expose no allow action and stale/context-changed approvals cannot execute (verification: renderer and Electron; owner: approval UI and runtime adapters)
- AC12 — Supported desktop packages include the policy and parser assets and operate offline; final implementation records scoped test evidence, candidate documentation review, note cross-links, and the explicit auto consent behavior change (verification: packaged artifact and docs gate; owner: final implementation layer)

## Risks

Default allow intentionally requires no first-use Shell consent. An unmatched custom program, alias, hook, encoded payload, or script can perform destructive or external actions without a prompt. This policy is a usability guard, not a security boundary, and it does not add Shell filesystem containment. User-facing documentation and release notes must say so without calling auto safe.

Conservative incomplete analysis can create extra prompts for valid but unsupported shell constructs. Grammar assets, native parse helpers, and semantic adapters add platform/packaging obligations. The migration must not silently lose existing mandatory denials or claim that a small example rule list replaces the existing regression corpus. Changes to these boundaries require an updated Spec and renewed approval.
