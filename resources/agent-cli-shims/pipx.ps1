if (-not $env:CHERRY_STUDIO_UVX_PATH) {
  [Console]::Error.WriteLine("Cherry Studio could not locate its bundled uvx runtime.")
  exit 127
}

if ($args.Count -gt 0 -and $args[0] -eq "run") {
  [Console]::Error.WriteLine("Cherry Studio: routing pipx run to bundled uvx.")
  $forward = @($args | Select-Object -Skip 1)
  if ($forward.Count -gt 0 -and $forward[0] -eq "--spec") {
    if ($forward.Count -lt 2) {
      [Console]::Error.WriteLine("pipx run --spec requires a package.")
      exit 2
    }
    $forward = @("--from", $forward[1]) + @($forward | Select-Object -Skip 2)
  }
  & $env:CHERRY_STUDIO_UVX_PATH @forward
  exit $LASTEXITCODE
}

if ($args.Count -gt 0 -and ($args[0] -eq "--version" -or $args[0] -eq "-V")) {
  & $env:CHERRY_STUDIO_UVX_PATH --version
  exit $LASTEXITCODE
}

[Console]::Error.WriteLine(
  "Cherry Studio supports pipx run through bundled uvx; use cli_install for persistent Python CLIs."
)
exit 2
