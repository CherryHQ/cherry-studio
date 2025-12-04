const eq = (a: any, b: any) => {
  if (a && b && typeof a.equals === 'function') return a.equals(b)
  return a === b
}

export default eq
