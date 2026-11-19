# Add observation hooks after the user's startup files, without replacing their ZLE or prompt.
typeset -gr __cherry_token=$CHERRY_TERMINAL_TOKEN
unset CHERRY_TERMINAL_TOKEN CHERRY_TERMINAL_ZDOTDIR CHERRY_TERMINAL_ZSH_INTEGRATION
typeset -g __cherry_sequence=0
__cherry_zsh_prompt() {
  local result=$?
  emulate -L zsh
  (( __cherry_sequence++ ))
  builtin printf '\033]633;Cherry;%s;%s;P;%s;%s\007' "$__cherry_token" "$__cherry_sequence" "$result" "$(builtin printf '%s' "$PWD" | base64 | tr -d '\r\n')"
}
__cherry_zsh_before_command() {
  emulate -L zsh
  (( __cherry_sequence++ ))
  builtin printf '\033]633;Cherry;%s;%s;B\007' "$__cherry_token" "$__cherry_sequence"
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd __cherry_zsh_prompt
add-zsh-hook preexec __cherry_zsh_before_command
