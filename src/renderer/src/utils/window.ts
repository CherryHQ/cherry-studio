export const isFocused = () => {
  return document.hasFocus()
}

export const isOnHomePage = () => {
  return window.location.hash === '#/' || window.location.hash === '#' || window.location.hash === ''
}
