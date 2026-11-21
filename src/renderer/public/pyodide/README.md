# Managed Agent Python assets

The renderer worker uses the pinned Pyodide 0.28.0 core here, with Python 3.13.2, openpyxl 3.1.5 and et-xmlfile 2.0.0. These files are copied unchanged by Vite's public directory handling. The generated worker sits in `assets/`, so its sibling `../pyodide/` resolves in both development and the packaged renderer.

## Sources and integrity

- Core distribution: https://registry.npmjs.org/pyodide/-/pyodide-0.28.0.tgz
- openpyxl wheel: https://files.pythonhosted.org/packages/c0/da/977ded879c29cbd04de313843e76868e6e13408a94ed6b987245dc7c8506/openpyxl-3.1.5-py2.py3-none-any.whl
- et-xmlfile wheel: https://files.pythonhosted.org/packages/c1/8b/5fe2cc11fee489817272089c4203e679c63b570a5aaeb18d852ae3cbba6a/et_xmlfile-2.0.0-py3-none-any.whl

The npm tarball's SHA-512 integrity was checked against the npm registry, and each wheel's SHA-256 was checked against PyPI. `src/shared/data/presets/agentPythonRuntime.json` records the distributed bytes, versions and image identifier. `scripts/__tests__/agentPythonRuntime.test.ts` checks those hashes and the lockfile relationships in CI. `.gitattributes` prevents line-ending changes to these pinned files.

The local lockfile starts from this exact Pyodide distribution. Existing package filenames point to their original `https://cdn.jsdelivr.net/pyodide/v0.28.0/full/` location, preserving optional package behavior. Only openpyxl and et-xmlfile are added as local entries with their PyPI hashes. Pyodide's normal integrity checking applies to both. The core, standard library and managed XLSX packages need no network. Other optional packages still do.

## Updates

Update the core and packages as one reviewed image. Verify upstream archive and wheel hashes, rebuild the local lockfile with the same mapping, update the manifest hashes and image identifier, then run the explicit integrity tests and a clean offline worker XLSX round trip. `node scripts/check-agent-python-runtime.mjs` builds the real worker and tests both offline workbook processing and corrupt-wheel rejection. It uses Playwright's Chromium, or `CHROMIUM_EXECUTABLE_PATH` when supplied. Do not change the managed Python version as a side effect of adding a package. App upgrades do not edit Agent workspace files.

Managed packages load before user code is accepted, and the worker checks their installed versions. A missing or corrupt package produces a repair error rather than a package-install command. There is no new user package installation or upgrade API. This does not make arbitrary Python code a read-only or security sandbox.

Installed versions are emitted in the worker's initialization diagnostics and logged by `PyodideService`. Diagnostic exports identify the provisioned image and package versions separately as managed runtime fields. They do not claim that a worker has been started in the current session.

## Licenses

See `LICENSE-pyodide`, `LICENSE-python` and `THIRD-PARTY-NOTICES.txt`. The latter also contains the wheel-distributed license texts. These filenames intentionally survive the app's license-file exclusion patterns.
