---
title: Existing system CLI tools are now detected
category: changed
severity: notice
introduced_in_pr: "#16838"
date: 2026-07-11
---

## What changed

Dependencies and Code Tools now recognize supported CLI tools from the user's login-shell PATH. Advanced dependency-install settings also allow users to configure mirrors, registries, a GitHub token, and signature verification.

Fixed Dependencies and Code CLI entries are defined by Cherry Studio, while user-added custom tool definitions are stored separately. On each machine, Cherry Studio independently detects whether the exact mise recipe is applied and whether a runnable executable is available through mise, the app bundle, or the system PATH. Restoring custom definitions recreates cards only; it does not install tools or restore machine-local backend state.

Cherry Studio no longer reinstalls missing tools when the app starts. It also does not install a managed shadow copy over a runnable system or bundled executable.

## Why this matters to the user

System-installed tools are labeled as System and run from their existing location. Cherry Studio never updates or removes system or bundled executables.

For a fixed tool, Install, Update, and Uninstall affect only Cherry Studio's exact mise backend copy. Uninstalling that copy keeps the fixed card and falls back to a system or bundled executable when one exists. A custom tool keeps its portable definition when installation fails, so the card remains available for Retry or Remove.

When backend cleanup cannot be verified, Cherry Studio keeps the custom definition. A separate confirmation can remove only that definition and hide the card, with an explicit warning that backend files may remain. Fixed tools never offer this definition-only fallback.

## What the user should do

Continue managing system-installed tools with the package manager that installed them. Use Install, Update, or Uninstall only for Cherry Studio's fixed backend copies. Use Remove for custom tools; if Cherry Studio cannot safely clean up the backend, choose definition-only removal only when leaving residual files is acceptable.

For a missing custom tool, choose Retry to install from its saved definition or Remove to delete the definition. No startup action is required after restore unless you want to install the tool on that machine.

## Notes for release manager

The advanced settings affect only Cherry Studio's isolated mise installation environment. `feature.binary.tools` contains portable custom definitions, not installation records.
