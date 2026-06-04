# @repo/audit-cli

CLI tool that runs all five audit packages against a URL and prints a summary table or JSON output.

## Usage

```
$ audit-cli <url> [options]
```

### Flags

| Flag | Description |
|------|-------------|
| `--json` | Output JSON array of `AuditResult` objects to stdout |
| `--pretty` | Force pretty table output even when stdout is not a TTY |
| `--only <list>` | Comma-separated list of categories to run (e.g. `performance,seo`). Valid values: `performance`, `seo`, `best-practices`, `pwa`, `on-page` |
| `--form-factor <mobile\|desktop>` | Lighthouse emulation mode (default: `mobile`) |
| `--timeout <ms>` | Per-audit timeout in milliseconds (default: `30000`) |
| `--user-agent <string>` | User-agent sent by `audit-onpage` when fetching the page |
| `--no-color` | Disable ANSI colors in pretty output |
| `--debug` | Enable verbose progress output and Chrome stderr |

`--json` and `--pretty` are mutually exclusive. If neither is specified, pretty output is used when stdout is a TTY, JSON when it is not.

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | All five categories returned `status: "success"` |
| `1` | At least one category returned `status: "partial"` or `status: "failed"`. This is expected when Lighthouse 12 omits the PWA category. |
| `2` | CLI usage error (unknown flag, invalid URL, conflicting options) |

### Examples

```bash
# Pretty output to terminal
audit-cli https://example.com

# JSON output — useful for piping to jq
audit-cli https://example.com --json | jq '.[].score'

# Desktop form factor, only performance and SEO
audit-cli https://example.com --form-factor desktop --only performance,seo

# Docker / CI (no sandbox)
LH_NO_SANDBOX=1 audit-cli https://example.com --json
```

## Programmatic use

The aggregation logic is also available as a library:

```ts
import { aggregate } from "@repo/audit-cli/aggregate"
```

But prefer importing the individual audit packages directly for programmatic use. `audit-cli` is primarily a user-facing tool.

## Architecture

`audit-cli` runs Lighthouse once and shares the `RawLighthouseResult` with all four LH-backed packages (`audit-perf`, `audit-seo`, `audit-best-practices`, `audit-pwa`). `audit-onpage` fetches the URL independently via HTTP.

All five audits run concurrently via `Promise.all`.

## See also

- [@repo/audit-core](../audit-core/README.md)
- [Slice 1 design doc](../../docs/plans/2026-06-04-audit-packages-slice1-design.md)
