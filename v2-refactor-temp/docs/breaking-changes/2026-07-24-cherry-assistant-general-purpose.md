---
title: Cherry Assistant becomes a general-purpose built-in Agent
category: changed
severity: notice
introduced_in_pr: "#17398"
date: 2026-07-24
---

## What changed

Cherry Assistant is now added to existing Agent libraries as well as new ones. It can handle general writing, coding, analysis, translation, and research tasks, and its product answers are based on a manifest generated from the installed package.

It can also create content-rebuilt DOCX, PDF, PPTX, and XLSX files from supported text, HTML, and tabular sources. Its built-in Cherry-PPT Skill generates editable presentations from four Cherry Studio brand templates while preserving their PowerPoint Master and Layout structure. When a bundled capability cannot finish a task, it searches for the missing Skill and invokes the built-in Skill Creator when no suitable result exists before resuming the task.

Newly seeded Cherry Assistant instances default to automatic file-edit approval. Existing Assistant settings, user-edited instructions, persona files, memories, and deletion history are preserved. Reading an attached file is automatic, while saving original attachment bytes or exporting a new Office file still requires per-call approval.

## Why this matters to the user

Users can find Cherry Assistant in the Agent library without recreating their profile, use it for non-product, document, presentation, and data tasks, and get product routes, Providers, shortcuts, locales, and Agent capabilities that match the installed build.

Generic Office conversions rebuild content and do not preserve advanced source formatting, macros, animations, or formulas. Cherry-PPT uses its bundled red, enterprise-blue, Young, or CY2K template instead of the generic presentation style.

## What the user should do

Nothing - the change is automatic. Cherry Assistant still asks before installing third-party Skills. Users who prefer confirmation before each edit can change Cherry Assistant's permission mode in its Agent settings.
