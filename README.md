# Entra Docs Daily Reporter

Daily GitHub Actions report for Microsoft Entra documentation updates in a strict 24-hour window.

The workflow runs once a day at 06:00 UTC, collects updates from Entra docs sources, and posts a formatted GitHub issue so GitHub notifications can email you updates. The report window is an exact, non-overlapping calendar day (midnight to midnight, in the configured timezone), so a late-firing or re-run job always reports the same content instead of duplicating it. When the daily issue already exists, the workflow also adds a refresh comment that includes the latest report so a re-run email is not empty.

## Just Want the Daily Email?

You don't need to fork or run anything. This repo already runs the workflow on its own schedule - click **Watch** at the top of this page -> **All Activity**, and you'll get the same daily report emails as everyone else watching it. No Actions minutes, no secrets, no setup.

The tradeoff: you're relying on this repo staying up, and on its current schedule/timezone/tracked sources. Fork it (below) if you want an independent copy or different settings.

## 1-Minute Quick Start (Run Your Own Copy)

1. Fork or clone this repository.
2. In GitHub, open **Settings** -> **General** -> **Features** and make sure **Issues** is enabled for the repository.
3. Open **Actions** and run **Entra Docs Daily Reporter** with **Run workflow**.
4. Open the created issue titled `Daily Entra Docs PR Report - YYYY-MM-DD`.
5. If you forked into your own account, you're done - GitHub automatically watches repos you own, and that's what actually delivers the email, not the per-issue **Subscribe** button (a new issue is created every day, so subscribing to just one never covers the next day's). If you're running this under an org or shared account, click **Watch** at the top of the repo and choose **All Activity**.
6. You now receive daily updates through GitHub notification email.

## What You Get

- Strict 24-hour report window (no multi-day section in the issue body)
- Data sources:
  - `MicrosoftDocs/entra-docs` - all published Entra documentation
  - `MicrosoftDocs/azure-docs` - `active-directory-b2c` (Entra External ID / B2C content not yet migrated into entra-docs)
- Categories are derived automatically from each doc's folder path (Conditional Access, Authentication, App Provisioning, App Proxy, Hybrid Identity, Devices, Governance, CIEM, and more) - no fixed category list to maintain
- Each row includes:
  - Timestamp (configurable timezone, default Europe/Amsterdam)
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
- Timezone used for the report window, timestamps, and issue titles: `TZ` (default `Europe/Amsterdam`), set in the workflow's `env:` block
- Tracked repos/folders: edit the `PUBLISH_SOURCES` list at the top of `tools/entra-docs-reporter/report.mjs`

## Notes

- No SMTP provider is required.
- Delivery is via GitHub notifications, so account notification settings apply.
- Notifications work at the **repository** level here, not per-issue: this workflow creates a new issue every day, so clicking Subscribe on one issue only ever covers that one day. What actually delivers the recurring email is your repo-level Watch setting (owners watch their own repos by default). To stop the emails, use the **Watch** dropdown on the repo -> **Ignore**, or **Custom** and uncheck **Issues** - GitHub's API doesn't expose that level of control, only the web UI does.

## Troubleshooting

### `Unhandled error: HttpError: Issues has been disabled in this repository.`

The workflow publishes the report by creating or updating a GitHub issue and comments on existing daily issues with the latest report to force a fresh notification email. If repository issues are disabled, the run fails at the publish step.

Fix:

1. Open **Settings** -> **General** -> **Features**
2. Enable **Issues**
3. Re-run the workflow

This is currently a **manual** repository setting. It is not something this workflow can reliably automate with the default `GITHUB_TOKEN`, because enabling issues changes repository-level settings.
