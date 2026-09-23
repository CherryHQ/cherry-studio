# KBD Workspace Context Handling

KBD is designed to operate in multi-root VSCode workspaces where one project
is the **focus** (operated on) and others provide **read-only reference context**.

---

## The Multi-Root Workspace Problem

AI tools like Roo Code, Cline, Cursor Agent, and Windsurf operate within the
**entire VSCode workspace context** — they can read and write files in ANY
workspace folder unless explicitly constrained. This creates two risks:

1. **Write drift** — an executing tool modifies the wrong project's files
2. **Context confusion** — an assessing tool conflates two projects' codebases

KBD solves this by declaring three roles for workspace folders in `project.json`:

| Role        | Access       | Description                                          |
| ----------- | ------------ | ---------------------------------------------------- |
| `focus`     | Read + Write | The ONE project being operated on                    |
| `reference` | Read-only    | Other workspace folders used for spec/context lookup |
| `ignore`    | None         | Folders KBD should never touch or read               |

---

## Workspace Discovery in /kbd-init

When `/kbd-init` runs, it:

1. **Detects the `.code-workspace` file** — searches upward from cwd and in
   common parent directories (`../`, `../../`)
2. **Reads all `folders` entries** from the workspace JSON
3. **Auto-assigns roles** using heuristics:
   - The folder containing `AGENTS.md` or the current working directory → `focus`
   - Folders with names containing `MVP`, `legacy`, `spec`, `reference`, `docs` → `reference`
   - Everything else → prompts the user to classify

4. **Writes `workspace` block to `project.json`**

---

## project.json Workspace Block

```json
{
  "name": "HotSeaters",
  "focus_project_path": "/workspace/hotseaters",
  "workspace": {
    "workspace_file": "/workspace/HotSeatersMVP.code-workspace",
    "folders": [
      {
        "path": "/workspace/HotSeatersMVP",
        "role": "reference",
        "purpose": "Legacy spec reference — DocPage*.jsx files contain feature specifications",
        "read_paths": ["src/pages/Doc*.jsx", "src/pages/DocPage*.jsx"],
        "write_access": false
      },
      {
        "path": "/workspace/hotseaters",
        "role": "focus",
        "purpose": "Active project — all KBD operations target this directory",
        "write_access": true
      }
    ]
  }
}
```

---

## How Tools Must Respect Workspace Roles

Every AI tool executing a KBD change MUST read `project.json` → `workspace.folders`
and apply these rules:

### For `focus` folders

- All read and write operations are unrestricted within this folder
- `.kbd-orchestrator/` state files live here
- All change implementations target this folder

### For `reference` folders

- **Read-only** — never write, create, or delete files
- Use ONLY for spec lookup, understanding existing patterns, or legacy context
- If instructed to make "the same change" in a reference folder, refuse and note it is read-only

### For `ignore` folders

- Do not read or reference these folders at all

---

## Tool-Specific Enforcement

### Roo Code

Include in every Roo prompt preamble:

```
WORKSPACE CONTEXT:
- Focus project (read/write): /workspace/hotseaters
- Reference project (READ ONLY): /workspace/HotSeatersMVP
  Use only for: reading Doc*.jsx spec files to understand feature requirements
  NEVER write to this directory.
```

### Cline (Focus Chain)

Inject the workspace roles into Cline's context file / system prompt:

```
Focus: hotseaters/ (implements features)
Reference: HotSeatersMVP/ (spec only — DocPage*.jsx files — READ ONLY)
```

### Cursor Agent

Configure workspace rules in `.cursorrules` or agent system prompt.
Reference folders should be added to `files.exclude` or explicitly blocked in the agent context.

### Codex (git worktrees)

Worktrees operate on the `focus` project only. Do NOT create worktrees for
reference folders — they contain specs, not the target codebase.

### Antigravity

Antigravity respects AGENTS.md and the workspace roles are communicated via
the project context discovery. The focus project path is always used as the
operational root.

---

## Reference Folder Usage Patterns

Reference folders are valuable for KBD phases:

### During Assess

```
Read HotSeatersMVP/src/pages/DocPageClients.jsx
→ Extract: what the Clients page should do (spec)
→ Compare: against hotseaters/src/app/(routes)/clients/ (implementation)
→ Output: implementation gap in assessment.md
```

### During Plan

```
Read HotSeatersMVP/src/pages/DocPageDeals.jsx
→ Extract: Deal Wizard 4-step flow, Kanban/Card/List views
→ Produce: change-009-deals-page with accurate scope
```

### During Execute

```
Reference HotSeatersMVP component patterns for UI design guidance
→ Never copy code directly — always re-implement in the new stack
→ Use as a "what" reference, not "how" reference
```

---

## Workspace Section in kbd-init Output

When `/kbd-init` detects a `.code-workspace` file, it adds to the console summary:

```
KBD INIT — HotSeaters
━━━━━━━━━━━━━━━━━━━━
Focus project:    hotseaters/                  ← KBD operates here
Reference:        HotSeatersMVP/               ← Read-only spec source
  Spec files:     src/pages/Doc*.jsx, DocPage*.jsx

Workspace file:   HotSeatersMVP.code-workspace
project.json:     .kbd-orchestrator/project.json ✓ written
constraints.md:   .kbd-orchestrator/constraints.md ✓ written
```

---

## Edge Cases

### Multiple focus-eligible folders

If two folders both contain `AGENTS.md`, `/kbd-init` asks:

```
Multiple workspace roots contain AGENTS.md:
  1. hotseaters/
  2. some-other-project/
Which is the focus project? (enter number)
```

### Workspace file not found

KBD operates without workspace context, treating the cwd as the single focus project.
A warning is printed: `[kbd-init] No .code-workspace found — running single-project mode.`

### Nested workspace (workspace within workspace)

Not supported. KBD uses the first `.code-workspace` found in the search path.
