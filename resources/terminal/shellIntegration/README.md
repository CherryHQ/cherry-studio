# Shell startup and integration

The terminal pane starts the user's configured `$SHELL` on POSIX. When no shell is configured, it uses zsh on macOS and Bash on other POSIX systems. The PowerShell action remains available; Windows defaults to PowerShell when no `$SHELL` is configured. Agent Bash and PowerShell calls retain their explicit shell choice.

Zsh starts as an interactive login shell. The startup wrappers load the user's `.zshenv`, `.zprofile`, `.zshrc` and `.zlogin` in order, including an existing custom `ZDOTDIR`, then restore that directory before the interactive session. Zsh's `add-zsh-hook` appends prompt and command observation hooks. User themes, syntax-highlighting plugins, completion and ZLE bindings remain owned by the user's configuration. No line editor or highlighting plugin is bundled or installed.

Bash loads the user's `.bashrc` before adding its prompt and DEBUG hooks. PowerShell loads its profiles and retains its existing prompt and PSReadLine configuration. Other shells start with their own configuration and remain user-interactive; without a supported integration their shell state stays unknown, so Agent command submission is refused.

Host-admitted Bash commands use one ASCII input line with Bash's ANSI-C quoting. The shell decodes the original UTF-8 bytes, quotes, backslashes and line breaks before evaluation. This keeps readline from interpreting command bytes as editor shortcuts, including under the C locale, without changing the user's locale or interactive input.

Host-submitted PowerShell commands capture their final status inside `Invoke-Expression`, before that wrapper can reset `$?`. The next prompt consumes this result once; ordinary interactive commands use their own status, with a failed cmdlet remaining a failure even after a native exit code of zero.

PowerShell reports the prompt boundary before PSReadLine starts reading. Whole-command admission waits for a separate, prompt-fenced readiness marker from the native `PowerShell.OnIdle` event after PSReadLine verifies an empty editor buffer. This event runs after the reader's idle timeout, not a Host sleep. A late readiness marker cannot clear a user edit or authorize a different prompt. The original prompt marker still anchors the terminal's visible prompt correctly.

Verified prompt, cwd and command markers carry a per-process nonce and sequence. The Host removes those markers before capture and VT parsing. ANSI colors are emitted by the shell and applications, parsed by Ghostty and drawn by Canvas.

Zsh preexec and PowerShell's console-read-line hook also report complete command text as bounded base64 metadata. PowerShell delegates to the existing `PSConsoleHostReadLine` function and observes its accepted result, including commands omitted from history. Invalid UTF-8, malformed encoding or over-limit metadata leaves that command unavailable for Run again. Bash commands submitted through the Host retain their admitted text; interactive Bash command text remains unavailable rather than being inferred from `BASH_COMMAND` or screen contents. These hooks do not replace the user's editor or syntax highlighting.
