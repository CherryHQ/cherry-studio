---
title: "Channel requests use the agent's normal capabilities"
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-08-03
---

## What changed

Messages admitted by a channel's allowed chat, channel, or user IDs are passed to the agent without content rewriting or a channel-only restricted system prompt. Channel-linked Cherry Assistant sessions also retain their normal Assistant tools.

## Why this matters to the user

Trusted channel users can ask the configured agent to perform the same kinds of work it can perform from the Cherry Studio UI, subject to the agent's own tool permissions. Channel runs remain headless, so tools that require interactive approval still need an agent policy that can decide without a local prompt.

## What the user should do

Configure the channel's allowed IDs before granting the agent broad tool permissions. An empty allowed-ID list currently permits every chat or channel that can reach the bot.

## Notes for release manager

This removes the per-message external-content wrapper and the channel-only security prompt; output secret redaction remains enabled.
