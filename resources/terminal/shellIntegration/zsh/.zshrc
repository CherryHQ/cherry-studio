if (( ${+CHERRY_TERMINAL_ZDOTDIR} )); then
  export ZDOTDIR=$CHERRY_TERMINAL_ZDOTDIR
else
  unset ZDOTDIR
fi
if [[ $HISTFILE == "$CHERRY_TERMINAL_ZSH_INTEGRATION/.zsh_history" ]]; then
  HISTFILE=${ZDOTDIR-$HOME}/.zsh_history
fi
if [[ -r ${ZDOTDIR-$HOME}/.zshrc ]]; then source "${ZDOTDIR-$HOME}/.zshrc"; fi
if [[ -o login && -o rcs ]]; then
if (( ${+ZDOTDIR} )); then export CHERRY_TERMINAL_ZDOTDIR=$ZDOTDIR; else unset CHERRY_TERMINAL_ZDOTDIR; fi
export ZDOTDIR=$CHERRY_TERMINAL_ZSH_INTEGRATION
else
  source "$CHERRY_TERMINAL_ZSH_INTEGRATION/integration.zsh"
fi
