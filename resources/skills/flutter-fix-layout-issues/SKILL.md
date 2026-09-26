---
name: flutter-fix-layout-issues
description: Fixes Flutter layout errors (overflows, unbounded constraints) using Dart and Flutter MCP tools. Use when addressing "RenderFlex overflowed", "Vertical viewport was given unbounded height", or similar layout issues.
metadata:
  tags: ui, ux, flutter-fix-layout-issues
  version-origin: Prometheus packaging version; upstream did not declare a version
  model: models/gemini-3.1-pro-preview
  last_modified: Tue, 21 Apr 2026 19:45:59 GMT
license: BSD-3-Clause
version: 1.0.0-prometheus.1
---

## Prometheus distribution contract

This pinned upstream guidance is subordinate to the project's approved scope, design authority, framework versions, tool permissions, and phase boundary. Read PRODUCT.md, DESIGN.md, existing tokens and the affected application manifest before choosing advice. Apply relevant rules only; do not migrate frameworks or replace incumbent design by default.

Complete the implementation phase before a single consolidated verification pass; allow one batched correction and confirmation. Upstream per-edit tests, detector hooks and repetitive audit loops do not apply. Native platform execution requires its actual SDK/toolchain; portable guidance does not imply Windows can build or profile Apple applications. Never install a dependency, fetch a runtime, submit feedback, or message a third party merely because upstream suggests it.

Use the installed prometheus-ui-ux protocol for automatic selection. Taste guidance is limited to new surfaces or authorized redesign, one implementation plus at most one explicit overlay. No taste guidance applies to refinement or review. Existing DESIGN.md remains authoritative; generated recommendations and DESIGN.stitch.md cannot overwrite it without explicit authorization. User-only skills remain user-only in every harness; reading their source is not an invocation workaround.



# Resolving Flutter Layout Errors

## Contents
- [Constraint Violation Diagnostics](#constraint-violation-diagnostics)
- [Layout Error Resolution Workflow](#layout-error-resolution-workflow)
- [Examples](#examples)

## Constraint Violation Diagnostics

Flutter layout operates on a strict rule: **Constraints go down. Sizes go up. Parent sets position.** Layout errors occur when this negotiation fails, typically due to unbounded constraints or unconstrained children. 

Diagnose layout failures using the following error signatures:

*   **"Vertical viewport was given unbounded height"**: Triggered when a scrollable widget (`ListView`, `GridView`) is placed inside an unconstrained vertical parent (`Column`). The parent provides infinite height, and the child attempts to expand infinitely.
*   **"An InputDecorator...cannot have an unbounded width"**: Triggered when a `TextField` or `TextFormField` is placed inside an unconstrained horizontal parent (`Row`). The text field attempts to determine its width based on infinite available space.
*   **"RenderFlex overflowed"**: Triggered when a child of a `Row` or `Column` requests a size larger than the parent's allocated constraints. Visually indicated by yellow and black warning stripes.
*   **"Incorrect use of ParentData widget"**: Triggered when a `ParentDataWidget` is not a direct descendant of its required ancestor. (e.g., `Expanded` outside a `Flex`, `Positioned` outside a `Stack`).
*   **"RenderBox was not laid out"**: A cascading side-effect error. Ignore this and look further up the stack trace for the primary constraint violation (usually an unbounded height/width error).

## Layout Error Resolution Workflow

Copy and use this checklist to systematically resolve layout constraint violations.

### Task Progress
- [ ] Run the application in debug mode to capture the exact layout exception in the console.
- [ ] Identify the primary error message (ignore cascading "RenderBox was not laid out" errors).
- [ ] Apply the conditional fix based on the specific error type:
  - **If "Vertical viewport was given unbounded height"**: Wrap the scrollable child (`ListView`, `GridView`) in an `Expanded` widget to consume remaining space, or wrap it in a `SizedBox` to provide an absolute height constraint.
  - **If "An InputDecorator...cannot have an unbounded width"**: Wrap the `TextField` or `TextFormField` in an `Expanded` or `Flexible` widget.
  - **If "RenderFlex overflowed"**: Constrain the overflowing child by wrapping it in an `Expanded` widget (to force it to fit) or a `Flexible` widget (to allow it to be smaller than the allocated space).
  - **If "Incorrect use of ParentData widget"**: Move the `ParentDataWidget` to be a direct child of its required parent. Ensure `Expanded`/`Flexible` are direct children of `Row`/`Column`/`Flex`. Ensure `Positioned` is a direct child of `Stack`.
- [ ] Execute Flutter hot reload.
- [ ] Run validator -> review errors -> fix: Inspect the UI to verify the red/grey error screen or yellow/black overflow stripes are resolved. If new layout errors appear, repeat the workflow.

## Examples

### Fixing Unbounded Height (ListView in Column)

**Input (Error State):**
```dart
// Throws "Vertical viewport was given unbounded height"
Column(
  children: <Widget>[
    const Text('Header'),
    ListView(
      children: const <Widget>[
        ListTile(title: Text('Item 1')),
        ListTile(title: Text('Item 2')),
      ],
    ),
  ],
)
```

**Output (Resolved State):**
```dart
// Wrap ListView in Expanded to constrain its height to the remaining Column space
Column(
  children: <Widget>[
    const Text('Header'),
    Expanded(
      child: ListView(
        children: const <Widget>[
          ListTile(title: Text('Item 1')),
          ListTile(title: Text('Item 2')),
        ],
      ),
    ),
  ],
)
```

### Fixing Unbounded Width (TextField in Row)

**Input (Error State):**
```dart
// Throws "An InputDecorator...cannot have an unbounded width"
Row(
  children: [
    const Icon(Icons.search),
    TextField(), 
  ],
)
```

**Output (Resolved State):**
```dart
// Wrap TextField in Expanded to constrain its width to the remaining Row space
Row(
  children: [
    const Icon(Icons.search),
    Expanded(
      child: TextField(),
    ),
  ],
)
```

### Fixing RenderFlex Overflow

**Input (Error State):**
```dart
// Throws "A RenderFlex overflowed by X pixels on the right"
Row(
  children: [
    const Icon(Icons.info),
    const Text('This is a very long text string that will definitely overflow the available screen width and cause a RenderFlex error.'),
  ],
)
```

**Output (Resolved State):**
```dart
// Wrap the Text widget in Expanded to force it to wrap within the available constraints
Row(
  children: [
    const Icon(Icons.info),
    Expanded(
      child: const Text('This is a very long text string that will definitely overflow the available screen width and cause a RenderFlex error.'),
    ),
  ],
)
```
