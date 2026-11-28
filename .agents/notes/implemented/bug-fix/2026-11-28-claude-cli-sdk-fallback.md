# Agent Note: Reuse the downloaded Claude SDK CLI when discovery misses

Status: implemented

English | [中文](2026-11-28-claude-cli-sdk-fallback.zh.md)

## Problem

Local Claude Code discovery could report that Claude was missing even after Cherry Studio downloaded a working CLI for the built-in Claude Agent SDK. Starting Claude from the Code CLI entry could then attempt a second installation.

## Decision

Use the SDK download as the final automatic fallback for Claude Code. The download service validates the executable for the app's pinned SDK version and platform. Explicit executable settings and detected installations take precedence. Agent Services refreshes discovery when the download becomes ready.

## Alternatives considered

- Install a separate CLI on first launch. This adds another download and changes the user's system environment.
- Prefer the SDK copy on every launch. This bypasses the CLI the user already configured or installed.

## Consequences

The SDK download becomes available to local Claude sessions, model discovery, login, and terminals. The download service keeps ownership of the file and its updates. Agent Services exposes uninstall only for separately installed CLIs.

## Verification

- Regression — `launch.test.ts` and `CodeCliService.test.ts` cover fallback when discovery misses, precedence for explicit and installed executables, and terminal launch using the downloaded path.
- In an isolated macOS Electron profile without a system Claude CLI, the real download changed the Agent Services status from missing to installed automatically. The downloaded CLI reported version 2.1.311 and returned five models.
