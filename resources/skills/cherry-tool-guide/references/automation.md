# Browser and Computer automation

Use the live Automation REPL: `automation_repl` / `automation_repl_reset` in ordinary
chat, or the `automation` server's `js` / `reset` tools in Agent sessions. Runtime
prefixes may differ. Code Mode is not required. Only enabled surfaces are usable.

- Browser tasks: load `cherry-browser`, then bind `var tab = await browser.getTab()`.
- Desktop tasks: load `cherry-computer`, then bind a known app with
  `var app = await computer.getApp('Calculator')`.

The first binding emits API documentation and initial state. Read them before the
next cell; do not search for the retired individual Browser/Computer MCP tools.
Use the object's methods to batch known actions and emit an observation at each
decision boundary. The host retains permissions, application ownership and stop state.

After context loss, request `browser.documentation()` or `computer.documentation()`.
Use `REPL_CONTEXT` to inspect variable names and generation, not repeated declarations.
After reset, bind again. Across turns, observe before acting with a retained handle.
Reset cannot grant permission, resume user-stopped control or authorize a new target.

If the tool is missing, check the session's Browser/Computer capability and the
corresponding global control setting. Desktop actions also require OS permissions.
Channel-linked or restricted Agent sessions may not expose automation. Report the
actual missing capability; do not use shell, browser profiles or global input to
bypass it. Runtime cleanup failures are distinct from a user stopping control.
