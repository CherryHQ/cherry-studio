# Agent Note: Allow slow OpenClaw gateway cold starts

Status: implemented

English | [中文](2026-11-27-openclaw-cold-start.zh.md)

## Problem

In the [scheduled macOS regression](https://github.com/CherryHQ/cherry-studio/actions/runs/45886302981/job/140140326717), OpenClaw was still starting when Cherry Studio hit its 30-second health deadline. The application reported a launch failure and did not open the dashboard.

## Decision

Allow up to 60 seconds of readiness polling for a newly spawned gateway. Launch succeeds only when the existing health endpoint reports that the gateway is live. Early process exits still fail on the next poll.

## Alternatives considered

- Increasing the Playwright timeout would leave the application's own deadline in effect.
- Opening the dashboard as soon as the process spawns would expose a page whose server may still be unavailable.

## Consequences

A live but unhealthy process can take longer to report a startup failure. The same health check applies on macOS and Windows.

## Verification

- Regression — The OpenClaw service suite passed 169 tests, including successful launch when health becomes available after 35 seconds. CODE-03 checks the installed gateway, dashboard, and stop flow.
