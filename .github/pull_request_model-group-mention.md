  ### What this PR does

  Before this PR:

  - The @ mention panel did not support selecting model groups; users had to toggle models one-by-one.
  - No persistence for custom model sets; frequent, repetitive selection for common scenarios.
  - No group management (rename/delete), and no i18n keys for group-related UI.

  After this PR:

  - Adds a “Model Groups” section at the top of the @ panel (name + count). Clicking toggles the entire group selection.
  - Adds “Save selection as group...” to persist the current selection (same-name overwrite supported).
  - Supports group rename and delete (with confirmation).
  - Persists groups to Dexie settings under key mention:modelGroups using getModelUniqId(model) for members.
  - i18n added for group-related strings (mention_group.* in en-us.json and zh-cn.json).

  ### Screenshots

  Before:

  After:

  Fixes #

  ### Why we need it and why it was done in this way

  - Faster workflow: switch among common model sets in a single click, reducing repetitive toggles.
  - Persistence via Dexie settings keeps the footprint minimal and avoids schema migrations.
  - Group toggle iterates models and calls existing onMentionModel to inherit all current constraints (e.g., visual-only when images attached).
  - Group members identified by getModelUniqId(model) so they remain stable across provider changes.
  - “Save selection as group...” remains clickable; action performs validation (no-op with a prompt if nothing is selected), avoiding stale disabled state.

  The following tradeoffs were made:

  - Avoid “pinned groups” to reduce confusion with existing “pinned models”; simpler mental model and code path.
  - Group toggling fires per-model updates (consistent behavior and constraints) at the cost of a small delay on very large groups.

  The following alternatives were considered:

  - A single “bulk set-selection” path bypassing per-model checks (rejected to avoid duplicating/rewiring constraints).
  - A dedicated table for groups (opted for settings to keep it lightweight and migration-free).

  Links to places where the discussion took place:

  ### Breaking changes

  None.

  ### Special notes for your reviewer

  - Core UI: src/renderer/src/pages/home/Inputbar/MentionModelsButton.tsx
  - Storage: db.settings['mention:modelGroups']
  - i18n: src/renderer/src/i18n/locales/en-us.json, zh-cn.json (mention_group.*)
  - Please verify:
      - Group toggle respects existing constraints (e.g., attachment → visual models).
      - Same-name overwrite behavior when saving a group.
      - Rename/delete flows including delete confirmation.
      - i18n keys render correctly in both locales.

  ### Checklist

  - [ ] PR: Description is expressive and future-proof
  - [ ] Code: Readable and simple
  - [ ] Refactor: Left code cleaner (Boy Scout Rule)
  - [ ] Upgrade: Considered upgrade impact
  - [ ] Documentation: User-guide update considered or linked if needed
  - [ ] i18n: User-facing strings have translations updated (e.g., src/renderer/src/i18n/locales/*)

  ### Release note
  feat: Add “Model Groups” to the @ mention panel. Users can save, select, rename, and delete groups of models; groups persist in settings. Includes i18n for new UI strings.
  No breaking changes.