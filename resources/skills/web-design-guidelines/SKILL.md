---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".
metadata:
  tags: ui, ux, web-design-guidelines
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
license: MIT
---

## Prometheus distribution contract

This pinned upstream guidance is subordinate to the project's approved scope, design authority, framework versions, tool permissions, and phase boundary. Read PRODUCT.md, DESIGN.md, existing tokens and the affected application manifest before choosing advice. Apply relevant rules only; do not migrate frameworks or replace incumbent design by default.

Complete the implementation phase before a single consolidated verification pass; allow one batched correction and confirmation. Upstream per-edit tests, detector hooks and repetitive audit loops do not apply. Native platform execution requires its actual SDK/toolchain; portable guidance does not imply Windows can build or profile Apple applications. Never install a dependency, fetch a runtime, submit feedback, or message a third party merely because upstream suggests it.

Use the installed prometheus-ui-ux protocol for automatic selection. Taste guidance is limited to new surfaces or authorized redesign, one implementation plus at most one explicit overlay. No taste guidance applies to refinement or review. Existing DESIGN.md remains authoritative; generated recommendations and DESIGN.stitch.md cannot overwrite it without explicit authorization. User-only skills remain user-only in every harness; reading their source is not an invocation workaround.




# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

## How It Works

1. Read the bundled references/web-interface-guidelines.md
2. Read the specified files (or prompt user for files/pattern)
3. Check against all rules in the fetched guidelines
4. Output findings in the terse `file:line` format

## Guidelines Source

The pinned offline guidelines are in references/web-interface-guidelines.md. Upstream source:

```
https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
```

Read the bundled reference; do not fetch at runtime.

## Usage

When a user provides a file or pattern argument:
1. Read references/web-interface-guidelines.md
2. Read the specified files
3. Apply all rules from the fetched guidelines
4. Output findings using the format specified in the guidelines

If no files specified, ask the user which files to review.
