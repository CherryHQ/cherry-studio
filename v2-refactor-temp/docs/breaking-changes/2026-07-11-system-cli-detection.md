---
title: Existing system CLI tools are now detected
category: changed
severity: notice
introduced_in_pr: "#16838"
date: 2026-07-11
---

## What changed

Dependencies and Code Tools now recognize supported CLI tools from the user's login-shell PATH when Cherry Studio does not manage another copy. Advanced dependency-install settings also allow users to configure mirrors, registries, a GitHub token, and signature verification. Cherry Studio no longer silently reinstalls an owned tool that is missing when the app starts.

Cherry Studio also never claims ownership of a tool implicitly. A tool that already exists in Cherry Studio's own tool environment but is not yet managed now shows an explicit "Manage with Cherry Studio" action that records ownership without reinstalling the tool or changing its version. A tool found only on the system PATH instead shows "Install a Cherry-managed copy", which installs a separate managed copy and leaves the system binary untouched. Bundled tools remain read-only.

## Why this matters to the user

System-installed tools are labeled as System and launch from their existing location instead of prompting for another installation. Cherry Studio does not upgrade or remove those tools. If an owned tool was removed externally or quarantined, it stays missing and the Dependencies or Code Tools page offers explicit recovery or ownership removal. Bringing an already-present tool under Cherry Studio management is now an explicit, confirmed choice — never a side effect of the tool merely being detected — and once claimed, update and remove controls appear for it.

## What the user should do

Continue managing system-installed tools with the package manager that installed them. To let Cherry Studio update or remove a tool it detects but does not yet manage, use "Manage with Cherry Studio" (for a tool already in Cherry Studio's environment) or "Install a Cherry-managed copy" (for a system-only tool). For a missing Cherry-owned tool, choose retry to install it again or remove to clear Cherry Studio's ownership record.

## Notes for release manager

The advanced settings affect only Cherry Studio's isolated mise installation environment.
