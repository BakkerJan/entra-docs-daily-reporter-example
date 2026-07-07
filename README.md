# Entra Docs Daily Reporter

Daily GitHub Actions report for newly opened Microsoft Entra documentation PRs.

The workflow runs at 07:00 Europe/Amsterdam, groups PRs by subcategory, and posts a formatted daily issue so GitHub notifications can email you updates.

## 1-Minute Quick Start

1. Fork or clone this repository.
2. In GitHub, open **Actions** and run **Entra Docs Daily Reporter** with **Run workflow**.
3. Open the created issue titled `Daily Entra Docs PR Report - YYYY-MM-DD`.
4. Click **Subscribe** on that issue (or watch repo issues).
5. You now receive daily updates through GitHub notification email.

## What You Get

- Daily scan of:
  - `MicrosoftDocs/entra-docs`
  - `MicrosoftDocs/azure-docs` (filtered for Entra keywords)
- Grouped sections such as Conditional Access, Authentication, Identity Governance, and more
- HTML tables in the issue body for fast scanning
- Uploaded workflow artifacts (`html`, `md`, `json`)

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

- Change scanned repositories in workflow env: `ENTRA_DOC_REPOS`
- Change keyword filter in workflow env: `ENTRA_KEYWORDS`
- Adjust subcategory detection in `detectSubcategory(...)` inside `tools/entra-docs-reporter/report.mjs`

## Notes

- No SMTP provider is required.
- Delivery is via GitHub notifications, so user notification settings apply.
