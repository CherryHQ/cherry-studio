if (( ${+CHERRY_TERMINAL_ZDOTDIR} )); then
  export ZDOTDIR=$CHERRY_TERMINAL_ZDOTDIR
else
  unset ZDOTDIR
fi
if [[ -r ${ZDOTDIR-$HOME}/.zshenv ]]; then source "${ZDOTDIR-$HOME}/.zshenv"; fi
if [[ -o rcs ]]; then
if (( ${+ZDOTDIR} )); then export CHERRY_TERMINAL_ZDOTDIR=$ZDOTDIR; else unset CHERRY_TERMINAL_ZDOTDIR; fi
export ZDOTDIR=$CHERRY_TERMINAL_ZSH_INTEGRATION
fi
