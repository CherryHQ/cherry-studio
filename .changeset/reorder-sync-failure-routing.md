---
---

Route synchronous `ReorderableList.onReorder` throws through `onReorderError`, matching asynchronous rejection handling while keeping callback invocation synchronous. `@cherrystudio/ui` is excluded from Changesets releases, so this behavior fix does not request a package version bump. The accompanying unknown-parameter audit comments preserve the other packages' APIs and behavior.
