### What this PR does

Before this PR:
- Users could only add/remove models one by one in the provider settings model list.
- There was no way to batch select multiple models across groups for adding.

After this PR:
- Added batch selection checkboxes to the model list in Provider Settings.
- Each model group header now has a checkbox supporting three states: unchecked, indeterminate (partially selected), and checked (all selectable models in the group are selected).
- Each model row has an individual checkbox for single selection.
- When models are selected, a `+N` button appears in the group header to batch add the selected models.
- For New API providers, if any selected model lacks `supported_endpoint_types`, a popup prompts the user to choose the endpoint type before batch adding.
- Selected models are automatically cleared from the selection state after being successfully added.
- Already-added models are visually distinguished with a light green background.

Fixes #

### Why we need it and why it was done in this way

The following tradeoffs were made:
- Used local `useState` for selection state instead of Redux to keep the UI state scoped and avoid adding new Redux slices (which are currently blocked until v2.0.0).
- Used `FileItem` component to render model rows for consistency with existing list UI, even though the naming is file-oriented.
- Selection state is cleared when `modelGroups` changes (e.g., on search/filter) to avoid stale selections.

The following alternatives were considered:
- Adding a global "select all" checkbox at the top of the list: deferred to keep the initial implementation focused on group-level selection.
- Extracting a shared component between `NewApiBatchAddModelPopup` and `NewApiAddModelPopup`: deferred to avoid scope creep; both popups share similar form logic but have different entry points.

Links to places where the discussion took place: <!-- optional: slack, other GH issue, mailinglist, ... -->

### Breaking changes

N/A

### Special notes for your reviewer

- The `vitest.config.ts` change (switching pool from `threads` to `forks`) is included for Windows stability and is unrelated to the feature.
- Please pay special attention to the `addModelsWithValidation` async flow for New API providers.

### Checklist

This checklist is not enforcing, but it's a reminder of items that could be relevant to every PR.
Approvers are expected to review this list.

- [x] PR: The PR description is expressive enough and will help future contributors
- [x] Code: [Write code that humans can understand](https://en.wikiquote.org/wiki/Martin_Fowler#code-for-humans) and [Keep it simple](https://en.wikipedia.org/wiki/KISS_principle)
- [x] Refactor: You have [left the code cleaner than you found it (Boy Scout Rule)](https://learning.oreilly.com/library/view/97-things-every/9780596809515/ch08.html)
- [ ] Upgrade: Impact of this change on upgrade flows was considered and addressed if required
- [x] Documentation: A [user-guide update](https://docs.cherry-ai.com) was considered and is present (link) or not required. Check this only when the PR introduces or changes a user-facing feature or behavior.
- [x] Self-review: I have reviewed my own code (e.g., via [`/gh-pr-review`](/.claude/skills/gh-pr-review/SKILL.md), `gh pr diff`, or GitHub UI) before requesting review from others

### Release note

```release-note
Added batch selection checkboxes to the provider settings model list, allowing users to select multiple models at once (by group or individually) and add them in bulk. For New API providers, a confirmation popup is shown when the selected models require an endpoint type to be specified.
```
