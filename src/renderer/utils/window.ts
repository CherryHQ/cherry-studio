export const isFocused = () => {
  return document.hasFocus()
}

export const isOnHomePage = () => {
  return window.location.hash === '#/app/chat' || window.location.hash === '#' || window.location.hash === ''
}
