---
title: Knowledge bases accept all recognized text files
category: other
severity: notice
introduced_in_pr: '#20378'
date: 2026-09-11
---

## What changed

Knowledge bases can now import every text file recognized by Cherry Studio, including source code, compound extensions, and extensionless text files.

## Why this matters to the user

The knowledge file picker no longer hides text formats outside a small document-focused allowlist.

## What the user should do

nothing — automatic

## Notes for release manager

Structured documents keep their existing readers, while text files use the local text reader.
