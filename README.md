# Entra Docs Daily Reporter

Daily GitHub Actions report for Microsoft Entra documentation updates in a strict 24-hour window.

The workflow runs at 05:00 and 06:00 UTC each day (covering Amsterdam DST transitions), collects updates from Entra docs sources, and posts a formatted GitHub issue so GitHub notifications can email you updates. When the daily issue already exists, the workflow also adds a refresh comment that includes the latest report so the rerun email is not empty.

## 1-Minute Quick Start

1. Fork or clone this repository.
2. In GitHub, open **Settings** -> **General** -> **Features** and make sure **Issues** is enabled for the repository.
3. Open **Actions** and run **Entra Docs Daily Reporter** with **Run workflow**.
4. Open the created issue titled `Daily Entra Docs PR Report - YYYY-MM-DD`.
5. Click **Subscribe** on that issue (or watch repo issues).
6. You now receive daily updates through GitHub notification email.

## What You Get

- Strict 24-hour report window (no multi-day section in the issue body)
- Data source:
  - `MicrosoftDocs/entra-docs` via commit feed under `docs/<subpage>`
- **23 smart categories** (Conditional Access, Authentication, App Provisioning, App Proxy, Hybrid Identity, Devices, Governance, CIEM, and 15 more)
- Each row includes:
  - Timestamp (Europe/Amsterdam timezone)
  - Author
  - PR/Commit number and title
  - Commit URL
  - **MS Learn URL** (when document is published to Learn)
  - PR URL
- Email-friendly Markdown tables with padding for readability
- Uploaded artifacts: `html`, `md`, `json`

## Repo Structure

- `.github/workflows/entra-docs-daily-reporter.yml` - Schedule and publishing workflow
- `tools/entra-docs-reporter/report.mjs` - Report generator
- `tools/entra-docs-reporter/README.md` - Extended configuration guide
- `docs/entra-docs-daily-reporter-publish.md` - Copy/paste blog section

## Manual Test

Use this command to trigger a report manually:

```bash
gh workflow run "Entra Docs Daily Reporter" --repo <owner>/<repo>
```

Then check the latest run:

```bash
gh run list --workflow "entra-docs-daily-reporter.yml" --repo <owner>/<repo> --limit 1
```

## Customize

- Main window: `LOOKBACK_HOURS` (default `24`)
- Entra Docs base path: `ENTRA_DOCS_COMMITS_PATH` (default `docs`)
- Entra Docs tracked subpages: `ENTRA_DOCS_SUBPAGES`

## Notes

- No SMTP provider is required.
- Delivery is via GitHub notifications, so account notification settings apply.

## Troubleshooting

### `Unhandled error: HttpError: Issues has been disabled in this repository.`

The workflow publishes the report by creating or updating a GitHub issue and comments on existing daily issues with the latest report to force a fresh notification email. If repository issues are disabled, the run fails at the publish step.

Fix:

1. Open **Settings** -> **General** -> **Features**
2. Enable **Issues**
3. Re-run the workflow

This is currently a **manual** repository setting. It is not something this workflow can reliably automate with the default `GITHUB_TOKEN`, because enabling issues changes repository-level settings.
