---
title: Web lookup failures now stop with actionable errors
category: changed
severity: notice
introduced_in_pr: "#17198"
date: 2026-07-21
---

## What changed

Web lookup failures caused by permanent configuration problems now stop the assistant's tool loop immediately instead of being retried. If an assistant reaches its configured tool-call step limit while still requesting tools, the turn now ends with an explicit error instead of an empty successful response.

## Why this matters to the user

Users may now see an actionable Web Search or network error earlier in a turn, and long-running tool loops report that their configured limit was reached rather than appearing to finish without an answer.

## What the user should do

Follow the error guidance to configure a compatible Web Search provider, add any required API key or API host, or check the network connection and try again. For legitimate long-running tasks, increase the assistant's tool-call limit or reduce the task scope.

## Notes for release manager

The SSRF guard remains unchanged; Clash Fake-IP addresses are still rejected.
