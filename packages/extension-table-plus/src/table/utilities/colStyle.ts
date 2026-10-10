export function getColStyleDeclaration(minWidth: number, width: number | undefined): [string, string] {
  if (width) {
    // apply the stored width unless it is below the configured minimum cell width
    return ['width', `${Math.max(width, minWidth)}px`]
  }

  // set the minimum with on the column if it has no stored width
  return ['min-width', `${minWidth}px`]
}
