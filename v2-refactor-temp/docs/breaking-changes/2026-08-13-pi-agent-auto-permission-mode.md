---
title: Fast (Pi) agents get an "Approve for Me" mode and start in it; Full Access now really skips everything
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-08-13
---

## What changed

Fast (Pi) agents now offer the "Approve for Me" permission mode, and new ones are created in it instead of
"Auto-accept Edits". In that mode the agent works on its own and asks when it recognizes a risky action: a
destructive shell command (`rm`, `sudo`, `git reset --hard`, a piped remote script, a command reaching into the
home directory, …), or a file tool pointed outside its workspace and data directory.

"Full Access" on a Fast (Pi) agent now lifts every approval prompt: tools that used to keep asking even there
(knowledge-base edits, image generation, CLI installs, assistant settings tools) run without a prompt. Two
explicit safety blocks still apply — disabled tools, and shell commands that install into the shared global
environment (`npm install -g`, `pip install --user`, …), which are denied outright rather than prompted.

Advanced (Claude Agent) agents are unchanged.

## Why this matters to the user

A new Fast agent interrupts far less than before, stopping when it recognizes a risky operation.
Users who had picked "Full Access" on a Fast agent will notice it has become genuinely unattended — only
disabled tools and global installs are still held back, and those are denied without interrupting.

## What the user should do

Nothing — automatic. Existing agents keep the permission mode they were saved with. Anyone who relied on "Full
Access" still prompting for knowledge-base or install operations should switch that agent to "Approve for Me".

## Notes for release manager

The "Approve for Me" copy differs between runtimes on purpose: on Claude it is the model's own safety classifier
(and carries a "depends on the model" caveat), on Pi it is Cherry's own deterministic rule set with its own
caveat. The Pi command check is a best-effort net against ordinary mistakes, not a defense against a deliberately
obfuscated command, and it does not confine shell commands to the workspace the way the file tools are confined —
do not describe the mode as a sandbox or a security guarantee.

"Full Access" on Pi now also applies to unattended turns (heartbeat, scheduled, channel). An agent that receives
messages from an external channel and is set to Full Access can therefore run billed or persistent operations
without a human in the loop — worth calling out wherever Full Access is documented.
