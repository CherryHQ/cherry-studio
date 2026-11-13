# Agent Note: Exit development preboot relaunch without an unavailable dialog

Status: implemented

English | [中文](2026-11-07-preboot-development-relaunch.zh.md)

## Problem

MP-121 completed its profile wipe, then failed during the preboot relaunch. Application.relaunch unconditionally displayed the development warning through showMessageBoxSync before Electron was ready.

## Decision

Show the manual-restart dialog only after app.isReady(); otherwise log the existing warning and exit successfully. The branch E2E explicitly observes that successful preboot exit and starts the fresh profile once more.

## Alternatives considered

Waiting for readiness would let profile initialization overlap a preboot operation. Ignoring every launch failure could conceal a genuine crash.

## Consequences

Packaged relaunch behavior is unchanged. Development mode still requires manual restarts; the controller accepts only exit code zero and verifies that the reset marker and seeded file disappeared.

## Verification

- Regression — `Application.relaunch.test.ts` reproduces Electron’s pre-ready dialog rejection and verifies successful exit both before and after readiness. The pre-ready case failed before the fix.
