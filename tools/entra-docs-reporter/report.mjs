import fs from "node:fs/promises";
import path from "node:path";

const GITHUB_API = "https://api.github.com";

function getEnv(name, fallback = "") {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escMd(value) {
  return String(value)
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function mdLink(label, url) {
  if (!url || !String(url).trim()) {
    return "-";
  }
  return `[${label}](${url})`;
}

function normalizeDocPath(filePath) {
  let path = filePath.replace(/\\/g, "/").replace(/\.md$/i, "");
  if (path.endsWith("/index")) {
    path = path.slice(0, -6);
  }
  return path;
}

// Non-publishable top-level folders under docs/ in MicrosoftDocs/entra-docs
const ENTRA_DOCS_NON_PUBLISH_FOLDERS = new Set([
  "breadcrumb",
  "backup",
  "includes",
  "media",
  "standards",
  "architecture",
]);

function isLikelyLearnPagePath(repo, filePath) {
  const p = filePath.replace(/\\/g, "/").toLowerCase();
  if (!p.endsWith(".md")) {
    return false;
  }
  if (p.endsWith("/toc.md") || p.endsWith("/toc.yml") || p.endsWith("/index.yml")) {
    return false;
  }

  if (repo.toLowerCase() === "microsoftdocs/azure-docs") {
    if (!p.startsWith("articles/")) return false;
    if (p.includes("/includes/")) return false;
    if (p.includes("/media/")) return false;
    return true;
  }

  if (repo.toLowerCase() === "microsoftdocs/entra-docs") {
    if (!p.startsWith("docs/")) return false;
    const topFolder = p.slice("docs/".length).split("/")[0];
    if (ENTRA_DOCS_NON_PUBLISH_FOLDERS.has(topFolder)) return false;
    return true;
  }

  return true;
}

function toMsLearnUrl(repo, filePath) {
  const normalized = normalizeDocPath(filePath);
  const lowerNorm = normalized.toLowerCase();
  
  if (repo.toLowerCase() === "microsoftdocs/azure-docs") {
    if (lowerNorm.startsWith("articles/")) {
      return `https://learn.microsoft.com/en-us/azure/${normalized.slice("articles/".length)}`;
    }
    const idx = lowerNorm.indexOf("articles/");
    if (idx >= 0) {
      return `https://learn.microsoft.com/en-us/azure/${normalized.slice(idx + "articles/".length)}`;
    }
  }
  
  if (repo.toLowerCase() === "microsoftdocs/entra-docs") {
    if (lowerNorm.startsWith("docs/")) {
      return `https://learn.microsoft.com/en-us/entra/${normalized.slice("docs/".length)}`;
    }
    const idx = lowerNorm.indexOf("docs/");
    if (idx >= 0) {
      return `https://learn.microsoft.com/en-us/entra/${normalized.slice(idx + "docs/".length)}`;
    }
  }
  
  return "";
}

function toGithubSourceUrl(repo, filePath) {
  if (!filePath) return "";
  const normalizedPath = filePath.replace(/\\/g, "/");
  const repoLower = repo.toLowerCase();
  if (repoLower === "microsoftdocs/entra-docs") {
    return `https://github.com/MicrosoftDocs/entra-docs/blob/main/${normalizedPath}`;
  }
  if (repoLower === "microsoftdocs/azure-docs") {
    return `https://github.com/MicrosoftDocs/azure-docs/blob/main/${normalizedPath}`;
  }
  return `https://github.com/${repo}/blob/main/${normalizedPath}`;
}


function titleCase(value) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

// Extracts a human-readable "published via" label from a publish-batch commit message.
// For "Merge pull request #13804 from ..." → "Auto Publish #13804"
// For "Merging changes synced from ..." → "Learn Build Sync"
function extractPublishedVia(commitMessage) {
  const firstLine = (commitMessage || "").split("\n")[0].trim();
  const lower = firstLine.toLowerCase();

  if (lower.startsWith("merge pull request")) {
    const prMatch = firstLine.match(/#(\d+)/);
    if (prMatch) {
      return `Auto Publish #${prMatch[1]}`;
    }
  }
  if (lower.startsWith("merging changes synced from")) {
    return "Learn Build Sync";
  }
  return firstLine;
}

function toAmsterdamTime(iso) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  return formatter.format(new Date(iso)).replace(",", "");
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "entra-docs-daily-reporter"
    }
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`GitHub API error ${response.status} for ${url}: ${details}`);
  }

  return response.json();
}

async function listPullRequests(repo, token, sinceIso) {
  const items = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = `${GITHUB_API}/repos/${repo}/pulls?state=all&sort=created&direction=desc&per_page=${perPage}&page=${page}`;
    const pulls = await fetchJson(url, token);
    if (!Array.isArray(pulls) || pulls.length === 0) {
      break;
    }

    let reachedOlder = false;

    for (const pr of pulls) {
      if (new Date(pr.created_at) < new Date(sinceIso)) {
        reachedOlder = true;
        break;
      }
      items.push(pr);
    }

    if (reachedOlder || pulls.length < perPage) {
      break;
    }

    page += 1;
  }

  return items;
}

async function listPullFiles(repo, number, token) {
  const files = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = `${GITHUB_API}/repos/${repo}/pulls/${number}/files?per_page=${perPage}&page=${page}`;
    const pageItems = await fetchJson(url, token);

    if (!Array.isArray(pageItems) || pageItems.length === 0) {
      break;
    }

    files.push(...pageItems.map((f) => f.filename));

    if (pageItems.length < perPage) {
      break;
    }

    page += 1;
  }

  return files;
}

// Fetches all repo-level commits (no path filter) and returns those that are
// "Auto Publish – main to live" or "Merging changes synced" batch commits
// that landed within the time window.  These are the only commits that reflect
// content becoming live on learn.microsoft.com.
async function listPublishBatches(repo, token, sinceIso) {
  const items = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = `${GITHUB_API}/repos/${repo}/commits?per_page=${perPage}&page=${page}`;
    const commits = await fetchJson(url, token);

    if (!Array.isArray(commits) || commits.length === 0) {
      break;
    }

    let reachedOlder = false;

    for (const c of commits) {
      const createdAt = c.commit?.committer?.date || c.commit?.author?.date;
      if (!createdAt) {
        continue;
      }
      if (new Date(createdAt) < new Date(sinceIso)) {
        reachedOlder = true;
        break;
      }

      const msg = (c.commit?.message || "").toLowerCase();
      const isPublishBatch =
        (msg.startsWith("merge pull request") && msg.includes("auto publish")) ||
        msg.startsWith("merging changes synced from");

      if (isPublishBatch) {
        items.push(c);
      }
    }

    if (reachedOlder || commits.length < perPage) {
      break;
    }

    page += 1;
  }

  return items;
}

// Expands each publish-batch commit into one row per publishable doc file.
// Each row carries its own subcategory derived from the file path so the
// report stays grouped the same way as before.
async function rowsFromPublishBatches(repo, token, sinceIso) {
  const batches = await listPublishBatches(repo, token, sinceIso);
  const rows = [];
  const seen = new Set();

  for (const batch of batches) {
    const createdAt = batch.commit?.committer?.date || batch.commit?.author?.date;
    if (!createdAt) {
      continue;
    }

    const details = await getCommitDetails(repo, batch.sha, token);
    const allFiles = (details.files || []).map((f) => f.filename).filter(Boolean);
    const publishableFiles = allFiles.filter((f) => isLikelyLearnPagePath(repo, f));

    for (const filePath of publishableFiles) {
      // Deduplicate: a file can appear in both a prmerger and a learn-build sync
      const dedupKey = `${repo}#${filePath}`;
      if (seen.has(dedupKey)) {
        continue;
      }
      seen.add(dedupKey);

      const msLearnUrl = toMsLearnUrl(repo, filePath);
      const sourceUrl = toGithubSourceUrl(repo, filePath);

      // Derive subcategory from the file path. All publishable entra-docs files
      // live under docs/<section>/..., so segments[1] is the section name.
      // Files that don't match this pattern (e.g. from other repos if the
      // function is reused) fall back to "General".
      const segments = filePath.replace(/\\/g, "/").toLowerCase().split("/").filter(Boolean);
      let subcategory = "General";
      if (segments[0] === "docs" && segments[1]) {
        subcategory = titleCase(segments[1]);
        // If the file lives in a subfolder (docs/<section>/<subfolder>/<file>.md),
        // include the subfolder in the subcategory so items are grouped more granularly.
        if (segments[2] && segments.length >= 4) {
          subcategory = `${titleCase(segments[1])} > ${titleCase(segments[2])}`;
        }
      }

      // Use the file name as the human-readable title, converting kebab/snake to
      // title case so e.g. "how-to-transfer-authenticator-new-phone" becomes
      // "How To Transfer Authenticator New Phone".
      const fileName = filePath.split("/").pop() || filePath;
      const title = titleCase(fileName.replace(/\.md$/i, ""));

      rows.push({
        subcategory,
        sha: batch.sha,
        shortSha: batch.sha.slice(0, 7),
        title,
        fileName,
        repo,
        author: batch.commit?.committer?.name || batch.author?.login || "learn-build-service",
        publishedVia: extractPublishedVia(batch.commit?.message || ""),
        createdAt,
        labels: ["published"],
        source: "AutoPublish",
        commitUrl: batch.html_url,
        msLearnUrl,
        sourceUrl,
        prUrl: "",
        url: batch.html_url
      });
    }
  }

  return rows;
}

function groupRows(rows) {
  return rows.reduce((acc, row) => {
    acc[row.subcategory] ??= [];
    acc[row.subcategory].push(row);
    return acc;
  }, {});
}

async function getCommitDetails(repo, sha, token) {
  const url = `${GITHUB_API}/repos/${repo}/commits/${sha}`;
  return fetchJson(url, token);
}

function buildHtml({ generatedAtIso, sinceIso, grouped, total }) {
  const sections = Object.entries(grouped)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([subcategory, rows]) => {
      const trs = rows
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map((row) => {
          const labels = row.labels.length ? row.labels.join(", ") : "-";
          const sourceLink = row.sourceUrl ? `<a href="${esc(row.sourceUrl)}">source</a>` : "-";
          const learnLink = row.msLearnUrl ? `<a href="${esc(row.msLearnUrl)}">learn</a>` : "-";
          const commitLink = row.commitUrl ? `<a href="${esc(row.commitUrl)}">commit</a>` : "-";
          return `
            <tr>
              <td><a href="${esc(row.url)}">${esc(row.shortSha)}</a></td>
              <td>${esc(row.title)}</td>
              <td>${esc(row.repo)}</td>
              <td>${esc(row.author)}</td>
              <td>${esc(toAmsterdamTime(row.createdAt))}</td>
              <td>${esc(labels)}</td>
              <td>${commitLink}</td>
              <td>${learnLink}</td>
              <td>${sourceLink}</td>
            </tr>`;
        })
        .join("\n");

      return `
        <h2>${esc(subcategory)} (${rows.length})</h2>
        <table>
          <thead>
            <tr>
              <th>PR</th>
              <th>Title</th>
              <th>Repository</th>
              <th>Author</th>
              <th>Created (Europe/Amsterdam)</th>
              <th>Labels</th>
              <th>Commit</th>
              <th>Learn</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            ${trs}
          </tbody>
        </table>`;
    })
    .join("\n");

  const body = total === 0
    ? "<p>No new Entra-related documentation pull requests were opened in the last 24 hours.</p>"
    : sections;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    :root {
      color-scheme: light;
      --ink: #18253a;
      --muted: #526178;
      --line: #d9e1ec;
      --header: #0f355e;
      --accent: #e7f2ff;
      --card: #ffffff;
      --bg: #f4f7fb;
    }
    body {
      margin: 0;
      padding: 24px;
      font-family: Segoe UI, Tahoma, sans-serif;
      color: var(--ink);
      background: radial-gradient(circle at 10% 20%, #edf6ff 0, var(--bg) 35%, #f8fafc 100%);
    }
    .wrap {
      max-width: 1200px;
      margin: 0 auto;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 14px;
      box-shadow: 0 12px 32px rgba(20, 34, 54, 0.08);
      overflow: hidden;
    }
    .top {
      padding: 20px 24px;
      background: linear-gradient(100deg, #0f355e 0%, #0d5f8a 55%, #2d8da1 100%);
      color: white;
    }
    .top h1 {
      margin: 0 0 8px;
      font-size: 22px;
      line-height: 1.2;
    }
    .meta {
      font-size: 13px;
      color: #d8e5f5;
    }
    .content {
      padding: 18px 24px 28px;
    }
    h2 {
      margin: 22px 0 10px;
      color: var(--header);
      font-size: 18px;
      border-left: 4px solid #4e97d8;
      padding-left: 10px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
      table-layout: fixed;
      font-size: 13px;
    }
    th, td {
      border: 1px solid var(--line);
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
      word-wrap: break-word;
    }
    th {
      background: var(--accent);
      color: #10345d;
      font-weight: 700;
    }
    tr:nth-child(even) td {
      background: #fbfdff;
    }
    a {
      color: #0753a1;
      text-decoration: none;
    }
    .foot {
      margin-top: 14px;
      color: var(--muted);
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <h1>Daily Entra Documentation PR Report</h1>
      <div class="meta">Window: ${esc(sinceIso)} to ${esc(generatedAtIso)} | Total new PRs: ${total}</div>
    </div>
    <div class="content">
      ${body}
      <p class="foot">Generated automatically by GitHub Actions.</p>
    </div>
  </div>
</body>
</html>`;
}

function buildMarkdownWindow({ title, grouped, total, sinceIso, generatedAtIso }) {
  const sections = Object.entries(grouped)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([subcategory, rows]) => {
      const tableRows = rows
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map((row) => {
          const published = `  ${escMd(toAmsterdamTime(row.createdAt))}  `;
          const publishedVia = `  ${escMd(row.publishedVia || row.author)}  `;
          const docFile = `  ${escMd(row.fileName || row.title)}  `;
          const commit = `  ${mdLink("commit", row.commitUrl)}  `;
          const learn = `  ${mdLink("learn", row.msLearnUrl)}  `;
          const source = `  ${mdLink("source", row.sourceUrl)}  `;
          const pr = `  ${mdLink("pr", row.prUrl)}  `;
          return `|${published}|${publishedVia}|${docFile}|${commit}|${learn}|${source}|${pr}|`;
        })
        .join("\n");

      return `
## ${esc(subcategory)} (${rows.length})

| Published (Europe/Amsterdam) | Published via | Doc file | Commit | Learn | Source | PR |
|---|---|---|---|---|---|---|
${tableRows}`;
    })
    .join("\n\n");

  if (total === 0) {
    return [
      `## ${title}`,
      `Window: ${sinceIso} to ${generatedAtIso}`,
      "No updates in this window."
    ].join("\n\n");
  }

  return [
    `## ${title}`,
    `Window: ${sinceIso} to ${generatedAtIso}`,
    `Total items: ${total}`,
    "",
    sections
  ].join("\n");
}

function buildIssueBody({ generatedAtIso, primarySinceIso, primaryGrouped, primaryTotal }) {
  const primary = buildMarkdownWindow({
    title: "Last 24 Hours",
    grouped: primaryGrouped,
    total: primaryTotal,
    sinceIso: primarySinceIso,
    generatedAtIso
  });

  return [
    "# Daily Entra Documentation PR Report",
    "",
    primary,
    "",
    "Generated automatically by GitHub Actions."
  ].join("\n");
}

async function main() {
  const githubToken = getEnv("GITHUB_TOKEN");
  if (!githubToken) {
    throw new Error("Missing GITHUB_TOKEN");
  }

  const generatedAt = new Date();
  const generatedAtIso = generatedAt.toISOString();

  const lookbackHours = Number.parseInt(getEnv("LOOKBACK_HOURS", "24"), 10);

  // Anchor the lookback window to midnight (Amsterdam) of the current calendar day
  // rather than "now minus N hours".  This ensures that both the scheduled 07:00
  // run and a manual workflow_dispatch triggered later the same day always query
  // the same time range (yesterday midnight → today midnight, Amsterdam time).
  // Note: the workflow sets TZ=Europe/Amsterdam so Node.js local-time operations
  // (new Date(year, month, day)) resolve to Amsterdam midnight in UTC.
  const todayAmsterdamStr = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(generatedAt);
  const [amsYear, amsMonth, amsDay] = todayAmsterdamStr.split("-").map(Number);
  const midnightTodayAmsterdam = new Date(amsYear, amsMonth - 1, amsDay, 0, 0, 0, 0);
  const primarySince = new Date(midnightTodayAmsterdam.getTime() - lookbackHours * 60 * 60 * 1000);
  const primarySinceIso = primarySince.toISOString();

  const publishRows = await rowsFromPublishBatches(
    "MicrosoftDocs/entra-docs",
    githubToken,
    primarySinceIso
  );

  const primaryRows = publishRows;
  const groupedPrimary = groupRows(primaryRows);

  const html = buildHtml({
    generatedAtIso,
    sinceIso: primarySinceIso,
    grouped: groupedPrimary,
    total: primaryRows.length
  });
  const issueBody = buildIssueBody({
    generatedAtIso,
    primarySinceIso,
    primaryGrouped: groupedPrimary,
    primaryTotal: primaryRows.length
  });

  const htmlOutputPath = getEnv("REPORT_OUTPUT", "report-output/entra-daily-report.html");
  const issueOutputPath = getEnv("ISSUE_OUTPUT", "report-output/entra-daily-report.md");
  await fs.mkdir(path.dirname(htmlOutputPath), { recursive: true });
  await fs.mkdir(path.dirname(issueOutputPath), { recursive: true });
  await fs.writeFile(htmlOutputPath, html, "utf8");
  await fs.writeFile(issueOutputPath, issueBody, "utf8");

  const dateLabel = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(generatedAt);

  const metadata = {
    title: `Daily Entra Docs PR Report - ${dateLabel}`,
    label: getEnv("ISSUE_LABEL", "entra-docs-report"),
    total24h: primaryRows.length,
    generatedAtIso,
    primarySinceIso
  };

  const metadataOutputPath = getEnv("REPORT_METADATA_OUTPUT", "report-output/entra-daily-report.json");
  await fs.mkdir(path.dirname(metadataOutputPath), { recursive: true });
  await fs.writeFile(metadataOutputPath, JSON.stringify(metadata, null, 2), "utf8");

  console.log(`Report created. 24h items: ${primaryRows.length}`);
  console.log(`Saved HTML report to ${htmlOutputPath}`);
  console.log(`Saved issue body to ${issueOutputPath}`);
  console.log(`Saved report metadata to ${metadataOutputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
