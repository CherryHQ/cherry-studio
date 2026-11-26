# Add observation and prompt markers after the user's startup files, preserving their ZLE and theme.
typeset -gr __cherry_token=$CHERRY_TERMINAL_TOKEN
unset CHERRY_TERMINAL_TOKEN CHERRY_TERMINAL_ZDOTDIR CHERRY_TERMINAL_ZSH_INTEGRATION
typeset -g __cherry_sequence=0
if (( $+functions[p10k] )); then
  typeset -g POWERLEVEL9K_TERM_SHELL_INTEGRATION=true
  builtin printf '\033]133;A;redraw=1\007'
fi
__cherry_zsh_prompt() {
  local result=$? percent=$options[promptpercent]
  emulate -L zsh
  (( __cherry_sequence++ ))
  builtin printf '\033]633;Cherry;%s;%s;P;%s;%s\007' "$__cherry_token" "$__cherry_sequence" "$result" "$(builtin printf '%s' "$PWD" | base64 | tr -d '\r\n')"
  if [[ $percent == on ]]; then
    local start=$'%{\e]133;A;redraw=1\a%}' input=$'%{\e]133;B\a%}'
    local continuation=$'%{\e]133;P;k=c\a%}'
    [[ $PS1 == *"$start"* ]] || PS1="$start$PS1$input"
    [[ $PS2 == *"$continuation"* ]] || PS2="$continuation$PS2$input"
  fi
}
__cherry_zsh_before_command() {
  emulate -L zsh
  (( __cherry_sequence++ ))
  builtin printf '\033]133;C\007'
  builtin printf '\033]633;Cherry;%s;%s;B;%s\007' "$__cherry_token" "$__cherry_sequence" "$(builtin printf '%s' "$1" | head -c 8193 | base64 | tr -d '\r\n')"
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd __cherry_zsh_prompt
add-zsh-hook preexec __cherry_zsh_before_command
