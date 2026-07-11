---
title: Existing system CLI tools are now detected
category: changed
severity: notice
introduced_in_pr: "#16838"
date: 2026-07-11
---

## What changed

Dependencies and Code Tools now recognize supported CLI tools from the user's login-shell PATH when Cherry Studio does not manage another copy. Advanced dependency-install settings also allow users to configure mirrors, registries, a GitHub token, and signature verification.

## Why this matters to the user

System-installed tools are labeled as System and launch from their existing location instead of prompting for another installation. Cherry Studio does not upgrade or remove those tools.

## What the user should do

Nothing — detection is automatic. Continue managing system-installed tools with the package manager that installed them.

## Notes for release manager

The advanced settings affect only Cherry Studio's isolated mise installation environment.
