// Stand-in for `@main/utils/rtk`, which rewrites Pi's `bash` commands; the browser runtime has no shell.
export async function rtkRewrite(): Promise<string | null> {
  return null
}
