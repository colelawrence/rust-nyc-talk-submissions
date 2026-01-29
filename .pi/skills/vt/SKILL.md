---
name: vt
description: Val Town CLI workflows for pi: verify auth, inspect project status, pull/push changes, tail logs, and open project metadata.
compatibility: Requires vt CLI installed via `deno install -grAf jsr:@valtown/vt` and a configured API key.
---

# Val Town (vt) Skill

Use this skill when working with Val Town projects to verify authentication, sync files, and inspect val status/logs.

## Setup

- Ensure `vt` is installed.
- Authenticate once via `vt whoami` (prompts for API key). You can also set `VT_API_KEY` in your shell environment.

## Quick Checks

```bash
vt --help
vt whoami
vt status
```

## Sync

```bash
vt pull
vt push
```

## Inspect

```bash
vt list
vt tail <val-name>
vt logs <val-name>
```

## Notes

- `vt whoami` and API actions require network access.
- Prefer `vt status` before `vt push` to avoid accidental overwrites.
- `vt telemetry` is not a valid command as of vt 0.1.51 (no telemetry subcommand).
- Available config options (via `vt config options`): `apiKey`, `globalIgnoreFiles`, `dangerousOperations.confirmation`, `editorTemplate`.
