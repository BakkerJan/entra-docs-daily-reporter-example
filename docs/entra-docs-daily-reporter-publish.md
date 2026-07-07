# Copy/Paste Example: Daily Entra Documentation PR Reporter

Use this example to track all newly opened Microsoft Entra documentation PRs and receive a daily HTML summary email.

Delivery model: the workflow posts a daily GitHub issue with HTML tables. GitHub issue notifications provide the email delivery.

## Features

- Runs on GitHub Actions
- Daily schedule at 07:00 (Europe/Amsterdam)
- HTML email with grouped tables per Entra subcategory
- Artifact upload with the rendered HTML report
- Easy to customize repos, keywords, and grouping logic

## Files

- `.github/workflows/entra-docs-daily-reporter.yml`
- `tools/entra-docs-reporter/report.mjs`
- `tools/entra-docs-reporter/package.json`
- `tools/entra-docs-reporter/README.md`

## Setup (2 minutes)

1. Copy the files into your repository.
2. Ensure the workflow can write issues (already configured in permissions).
3. Run the workflow manually once with **workflow_dispatch**.
4. Subscribe to the created report issue or watch the repository for issues.
5. Validate email notification and HTML table formatting.

## Suggested blog section

### Daily Microsoft Entra Docs PR Reporter

I use a GitHub Actions workflow that runs daily at 07:00 and emails me all newly opened Entra-related docs pull requests.

What I like:

- It catches updates from `MicrosoftDocs/entra-docs` and Entra-related content in `MicrosoftDocs/azure-docs`.
- The report is grouped by subcategory, so I can scan changes quickly.
- The email contains a styled HTML table and direct links to each PR.

How to adopt:

- Copy workflow and Node script
- Enable issue notifications in GitHub
- Adjust repository list and keyword filters
- Optionally tweak subcategory rules in `detectSubcategory(...)`

This makes docs change tracking fully automated and easy to share with teams.
