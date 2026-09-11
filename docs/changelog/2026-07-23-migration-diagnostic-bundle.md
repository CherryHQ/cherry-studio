---
title: Migration failures can save local diagnostics
category: other
severity: notice
introduced_in_pr: "#17307"
date: 2026-07-23
---

## What changed

Migration error and version-incompatible screens can now save a local diagnostic ZIP with minimal system information and, when available, one day of application logs. Nothing is uploaded automatically.

## Why this matters to the user

Users can create a support artifact without leaving the migration failure screen. If logs cannot be included, the screen explains that the saved ZIP contains only system information.

## What the user should do

Review the ZIP before sharing it because application logs may contain sensitive information, and share it only with the Cherry Studio support team.
