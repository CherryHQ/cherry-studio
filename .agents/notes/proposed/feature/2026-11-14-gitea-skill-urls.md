# Agent Note: Gitea skill URL installation

Status: proposed

English | [中文](2026-11-14-gitea-skill-urls.zh.md)

## Problem

Skill installation accepts a GitHub `SKILL.md` URL only on `github.com` and `raw.githubusercontent.com`. `parseGithubSkillUrl` in `src/shared/utils/skillMarketplace.ts` returns `null` for any other host, so a skill hosted on a privately deployed Gitea server cannot be searched, previewed or installed by URL (issue #20206). Users need the same single-skill install path for Gitea, including non-main branches such as `dev`.

## Proposal

### URL forms and install identity

Accept HTTPS URLs on any host in two Gitea shapes:

- `https://{host}/{owner}/{repo}/src/branch/{ref}/{dir}/SKILL.md`
- `https://{host}/{owner}/{repo}/raw/branch/{ref}/{dir}/SKILL.md`

The descriptor file name must be `SKILL.md` or `skill.md`, as for GitHub. `.git` repository suffixes are stripped. Tag routes and bare repository or tree URLs are out of scope. The ref is resolved with the same commit lookup GitHub uses, so branch names containing `/` resolve against the server's refs rather than by splitting the path.

The install source is `gitea:{https URL}`, where the URL is the canonical `src/branch` form of the skill's descriptor. The `github:` prefix and its URL shape do not change. Existing persisted sources keep their identity.

### Fetch and install

A `gitea:` source fetches over Git smart HTTP at `https://{host}/{owner}/{repo}.git`, then runs the same commit observation, target materialization, skill-directory validation, size limits and rollback as the GitHub fetcher. The commit whose tree is inspected is the one installed. Only the named skill directory is installed.

Access is anonymous. No token is requested, stored or sent. A server that requires authentication fails with the transport error it returns.

### Discovery and UI

`search_skills` and the install dialog recognize a Gitea `SKILL.md` URL and return one result, using the same single-result path as GitHub. Registry search is not queried for that input. Registry search and its results are otherwise unchanged. The result's registry label is `gitea`.

Skill validation, per-agent enablement, uninstall and rollback behavior are unchanged.

## Alternatives considered

- Generalize the `github:` prefix to any host: rejected because existing install sources, cache keys and tests depend on `github:`; a separate prefix keeps those identities stable and makes the host type explicit.
- Accept only the `src/branch` shape: rejected because raw links are what Gitea copies for downloads and the issue lists both forms.
- Use the Gitea REST contents API: rejected because its shape varies across Gitea versions and would bypass the verified git fetch path.
- Allow plain HTTP for LAN servers: rejected for now because credentials are not supported and plain HTTP exposes the fetched skill to tampering. Revisit with an explicit opt-in if needed.
- Require a per-host allowlist or settings entry: rejected because the user supplies the URL explicitly for each install; the cost is that the app contacts any HTTPS host the user names, recorded in Risks.

## Acceptance criteria

- AC1 — Both Gitea URL shapes on any HTTPS host parse to one skill result whose install source is `gitea:` followed by the canonical descriptor URL. (verification: unit; owner: Backend)
- AC2 — GitHub URLs and existing `github:`, `claude-plugins:`, `skills.sh:` and `clawhub:` sources parse and install as before. (verification: unit; owner: Backend)
- AC3 — Installing a `gitea:` source fetches the commit observed for the named ref and installs only the named skill directory, with existing validation, size limits and rollback. (verification: main-process integration against a local Git HTTP fixture; owner: Backend)
- AC4 — Non-HTTPS URLs, URLs with embedded credentials, bare repository or tree URLs, and URLs not ending in `SKILL.md` are rejected before anything is written to disk. (verification: unit; owner: Backend)
- AC5 — Search and the install dialog accept a Gitea `SKILL.md` URL, show exactly one result, and do not query registries for it. (verification: unit and renderer; owner: Frontend)
- AC6 — An authentication-required server fails with its transport error; no credential is read, stored or sent. (verification: main-process integration; owner: Backend)

## Risks

Any HTTPS host the user names is contacted, which can reach internal network services; the user initiates each install, and the fetched content is validated as for GitHub. Ref names containing `/` depend on the server's ref listing, which some Gitea deployments may restrict. Gitea versions differ in smart-HTTP behavior; the integration fixture covers one server build, so other versions remain unverified until tested. Anonymous access cannot install from private repositories.
