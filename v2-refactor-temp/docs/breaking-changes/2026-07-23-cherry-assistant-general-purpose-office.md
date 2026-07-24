---
title: Cherry Assistant is built into the Agent library
category: changed
severity: notice
introduced_in_pr: #17314
date: 2026-07-23
---

## What changed

Cherry Assistant is now included in new and existing Agent libraries unless the user previously deleted it. It starts in Auto-edit Mode, which allows file edits without confirmation while still asking before commands run. It is also a general-purpose assistant instead of only a Cherry Studio product helper, and can create content-rebuilt DOCX, PDF, PPTX, and XLSX files from supported text, HTML, and tabular sources. Its built-in Cherry-PPT Skill can generate editable presentations from four Cherry Studio brand templates while preserving their PowerPoint Master and Layout structure. When a bundled capability cannot finish a task, it searches for the missing Skill and invokes the built-in Skill Creator when no suitable result exists before resuming the task.

## Why this matters to the user

Existing users will see Cherry Assistant appear alongside their current Agents. They can ask it to complete ordinary writing, analysis, translation, coding, document, presentation, and data tasks directly in an Agent session. Capability gaps no longer end at an unsupported response or a manual workaround. Generic Office conversions rebuild content and do not preserve advanced source formatting, macros, animations, or formulas; Cherry-PPT uses its bundled red, enterprise-blue, Young, or CY2K template instead of the generic presentation style.

## What the user should do

Nothing - the new capabilities are available automatically. Cherry Assistant still asks before installing third-party Skills; locally authored fallback Skills are scoped to the missing capability and enabled for the current Agent.
