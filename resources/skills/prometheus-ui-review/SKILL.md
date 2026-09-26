---
name: prometheus-ui-review
description: Automatically review completed UI work for scope, incumbent identity, accessibility and platform behavior in a separate read-only context, without taste-driven redesign.
license: MIT
version: 1.0.0-prometheus.1
metadata:
  tags: ui, ux, prometheus-ui-review
  version-origin: Prometheus packaging version; upstream did not declare a version
---
# Prometheus automatic UI review
Use a separate reviewer context with native read-only permissions where the harness supports them. Do not edit project files or launch modifying commands. If no independent context exists, report independent review unavailable; do not relabel builder inspection.

Read the UI protocol and incumbent design context. Load the single most relevant auto-invocable craft skill (usually better-interface or better-accessibility), plus platform guidance relevant to the diff. Do not load taste implementations or overlays. Do not invoke or read-to-bypass user-only interface-review, break, variant or explain-interface.

At the completed phase boundary inspect the actual change and applicable captures: device widths, light/dark themes when supported, keyboard navigation and focus, loading/empty/error/disabled states, overflow and reduced motion. Apply WCAG target-size exceptions and native platform units accurately.

Return PASS or BLOCK, evidence paths, scoped blocking/nonblocking findings and unavailable checks. A PASS requires the stated acceptance evidence. Allow one batched correction and confirmation cycle. Outstanding blockers remain BLOCK and go to the operator. Never turn review into a redesign.

