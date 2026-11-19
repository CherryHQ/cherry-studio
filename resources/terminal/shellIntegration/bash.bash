# Cherry Studio managed Bash integration. Compatible with Bash 3.2 and later.
if [[ -r ~/.bashrc ]]; then source ~/.bashrc; fi
__cherry_token=$CHERRY_TERMINAL_TOKEN
unset CHERRY_TERMINAL_TOKEN
readonly __cherry_token
__cherry_sequence=0
__cherry_at_prompt=0
__cherry_saved_prompt_commands=("${PROMPT_COMMAND[@]-}")
unset PROMPT_COMMAND
__cherry_prompt() {
  local result=$?
  __cherry_at_prompt=0
  local hook
  for hook in "${__cherry_saved_prompt_commands[@]}"; do if [[ -n $hook ]]; then eval "$hook"; fi; done
  __cherry_sequence=$((__cherry_sequence + 1))
  local cwd=$PWD
  case $OSTYPE in msys*|cygwin*) cwd=$(cygpath -w -- "$PWD");; esac
  printf '\033]633;Cherry;%s;%s;P;%s;%s\007' "$__cherry_token" "$__cherry_sequence" "$result" "$(printf '%s' "$cwd" | base64 | tr -d '\r\n')"
  __cherry_at_prompt=1
}
__cherry_before_command() {
  if [[ $__cherry_at_prompt == 1 && $BASH_COMMAND != __cherry_prompt ]]; then
    __cherry_at_prompt=0
    __cherry_sequence=$((__cherry_sequence + 1))
    printf '\033]633;Cherry;%s;%s;B\007' "$__cherry_token" "$__cherry_sequence"
  fi
}
PROMPT_COMMAND=__cherry_prompt
trap '__cherry_before_command' DEBUG
