# Portable runtime API

Invoke with the actual installed skill directory and an argument array. Node 22 or newer is the only runtime. Resolve relative project paths against the invocation directory.

## Request shared by route and phase-boundary

| Field | Values and behavior |
|---|---|
| project | Required existing project directory. |
| ui | Boolean, default true. Explicit false returns no UI skills. The calling agent classifies whether the task changes rendered UI. |
| affected | Array of file/directory paths inside the project. Empty/omitted resolves the root. Future file paths use their ancestors. Windows separators are accepted; Windows absolute paths require Windows Node. |
| operation | new, redesign, refine or review; default refine. Other values are rejected. |
| surface | marketing, landing, pricing, campaign → Persuade; docs, documentation, reading, article, articles, changelog, changelogs → Read; showcase, portfolio → Experience; other/omitted → Operate. |
| model | Actual model identifier. GPT-family IDs select gpt-taste for new work; missing/non-GPT uses design-taste-frontend. Harness names do not imply a model. |
| focus | layout; typeset/typography; colorize/colors; clarify/copy; audit/harden/accessibility; animate/delight/motion. Other/omitted selects better-interface. |
| overlay | Explicitly selected high-end-visual-design, minimalist-ui or industrial-brutalist-ui; allowed only in new/redesign. Unsupported direction overlays are rejected. Refine/review ignore overlays. |
| role | Optional role identifier. Reviewer, verifier and auditor identifiers force review routing. |
| stack | Optional domain-query hint for Pro Max. Does not override manifest-based platform detection. |

Manifests are discovered from affected paths, including nested package.json, pubspec.yaml, Package.swift, Gradle and Cargo manifests. They are not supplied in JSON. Preserve declared SDK versions and verify platform prerequisites before applying advice.

The router returns context paths, application manifests/stacks, skill IDs, surface mode/dial ranges, a focused Pro Max query and whether establishing a design system is appropriate. A project protocol path is returned when present. The caller reads and applies that document as higher-priority design guidance; the runtime does not execute arbitrary Markdown as policy code.

### New implementation
```json
{"project":".","ui":true,"affected":["apps/web/src/Landing.tsx"],"operation":"new","surface":"marketing","model":"gpt-6","focus":"layout"}
```

### Refinement
```json
{"project":".","ui":true,"affected":["apps/mobile/lib/screen.dart"],"operation":"refine","surface":"app","focus":"accessibility"}
```

### Completed-phase review
```json
{"project":".","ui":true,"affected":["src/App.tsx"],"operation":"review","surface":"app"}
```

## Phase boundary

Run `node <skill-directory>/scripts/cli.mjs phase-boundary --input <request.json>` only after completing the production phase. It accepts the request above without additional evidence fields and returns:

```json
{"schemaVersion":1,"routing":{},"required":["applicable device/theme captures","keyboard and reduced-motion evidence","independent read-only review","one batched correction and confirmation"],"executed":false,"status":"evidence-required","hook":{"command":"node","args":["<absolute-cli-path>","phase-boundary","--input","<absolute-request-path>"]}}
```

The routing object contains the normal route output. For backend requests, required is empty. This is an evidence checklist and executable descriptor, not a capture engine, event listener or completed review receipt. Configure an existing phase runner to call it at the completed boundary; never attach it to per-edit events. No new daemon or automatic browser acquisition is supplied.

Exit 0 means the request was processed, not that UI acceptance passed. Malformed JSON, unknown commands/options, invalid operation values, inaccessible projects or escaping affected paths exit 2 with an error on stderr. Evidence acquisition/tool failures are reported by the tools that actually run them. Unavailable independent review remains unverified and unresolved blockers remain blocking.

## Project installation

`install --project <project> [--target AGENTS.md|CLAUDE.md|both] [--dry-run|--check]` preflights markers/paths, copies the portable catalog into .agents/skills and .claude/skills, and preserves project protocol overrides. Dry-run writes nothing; check exits 1 on drift and 0 when current. Usage/preflight failures exit 2. Changed instructions retain local recovery information.

Team installation belongs to the existing agent-team-creator runtime:
`node <creator-directory>/scripts/cli.mjs install-project --project <project> [--team <id>] [--dry-run|--check]`.
It preserves explicit selection, selects a sole team, and refuses ambiguous selection. Creator check uses exit 2 for drift and exit 1 for errors. No native execution is implied by writing definitions.
