# Shell startup and integration

The terminal pane starts the user's configured `$SHELL` on POSIX. When no shell is configured, it uses zsh on macOS and Bash on other POSIX systems. The PowerShell action remains available; Windows defaults to PowerShell when no `$SHELL` is configured. Agent Bash and PowerShell calls retain their explicit shell choice.

Zsh starts as an interactive login shell. The startup wrappers load the user's `.zshenv`, `.zprofile`, `.zshrc` and `.zlogin` in order, including an existing custom `ZDOTDIR`, then restore that directory before the interactive session. Zsh's `add-zsh-hook` appends prompt and command observation hooks. User themes, syntax-highlighting plugins, completion and ZLE bindings remain owned by the user's configuration. No line editor or highlighting plugin is bundled or installed.

Bash loads the user's `.bashrc` before adding its prompt and DEBUG hooks. PowerShell loads its profiles and retains its existing prompt and PSReadLine configuration. Other shells start with their own configuration and remain user-interactive; without a supported integration their shell state stays unknown, so Agent command submission is refused.

Verified prompt, cwd and command markers carry a per-process nonce and sequence. The Host removes those markers before capture and VT parsing. ANSI colors are emitted by the shell and applications, parsed by Ghostty and drawn by Canvas.
