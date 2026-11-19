if (( ${+CHERRY_TERMINAL_ZDOTDIR} )); then
  export ZDOTDIR=$CHERRY_TERMINAL_ZDOTDIR
else
  unset ZDOTDIR
fi
if [[ -r ${ZDOTDIR-$HOME}/.zlogin ]]; then source "${ZDOTDIR-$HOME}/.zlogin"; fi
source "$CHERRY_TERMINAL_ZSH_INTEGRATION/integration.zsh"
