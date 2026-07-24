import fs from "node:fs/promises";
import path from "node:path";

const GITHUB_API = "https://api.github.com";

// The workflow sets TZ so Node's local-time operations resolve to this zone.
// Read it back here (instead of hardcoding "Europe/Amsterdam") so changing
// the single TZ line in the workflow retimes the whole report consistently.
const REPORT_TZ = process.env.TZ && process.env.TZ.trim() ? process.env.TZ.trim() : "Europe/Amsterdam";

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

// Repos scanned for published Entra documentation changes. Most Entra content
// lives in entra-docs, but some hasn't been migrated out of azure-docs yet -
// Entra External ID's "customers" tenant type was Azure AD B2C, and that
// content still lives under azure-docs/articles/active-directory-b2c/.
// azure-docs is a much larger, busier repo covering all of Azure, so it's
// scoped to that one folder rather than scanned in full.
const PUBLISH_SOURCES = [
  { repo: "MicrosoftDocs/entra-docs" },
  { repo: "MicrosoftDocs/azure-docs", pathPrefixes: ["articles/active-directory-b2c/"] }
];

function isLikelyLearnPagePath(repo, filePath, pathPrefixes) {
  const p = filePath.replace(/\\/g, "/").toLowerCase();
  if (!p.endsWith(".md")) {
    return false;
  }
  if (p.endsWith("/toc.md") || p.endsWith("/toc.yml") || p.endsWith("/index.yml")) {
    return false;
  }

  // Restrict a source to specific folders (e.g. azure-docs is far too broad
  // to scan in full - only the still-unmigrated Entra-related subfolders
  // matter here).
  if (pathPrefixes && pathPrefixes.length > 0) {
    if (!pathPrefixes.some((prefix) => p.startsWith(prefix.toLowerCase()))) {
      return false;
    }
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

function toLocalTime(iso) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: REPORT_TZ,
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

// Just the clock time (no date, no seconds) - used in the digest, where every
// item already falls on the single calendar day named in the header.
function toLocalClock(iso) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: REPORT_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  return formatter.format(new Date(iso));
}

// Human-readable calendar day, e.g. "Thu, 23 Jul 2026".
function toLocalDateLabel(iso) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: REPORT_TZ,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
  return formatter.format(new Date(iso));
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

// Fetches repo-level commits (no path filter, so merge commits are included -
// GitHub's commits API silently drops merges when a `path` filter is used,
// but `since`/`until` are plain commit-date filters and don't have that
// problem) and returns those that are "Auto Publish – main to live" or
// "Merging changes synced" batch commits within [sinceIso, untilIso).  These
// are the only commits that reflect content becoming live on learn.microsoft.com.
async function listPublishBatches(repo, token, sinceIso, untilIso) {
  const items = [];
  let page = 1;
  const perPage = 100;
  const since = new Date(sinceIso);
  const until = new Date(untilIso);

  while (true) {
    const url = `${GITHUB_API}/repos/${repo}/commits?since=${encodeURIComponent(sinceIso)}&until=${encodeURIComponent(untilIso)}&per_page=${perPage}&page=${page}`;
    const commits = await fetchJson(url, token);

    if (!Array.isArray(commits) || commits.length === 0) {
      break;
    }

    for (const c of commits) {
      const createdAt = c.commit?.committer?.date || c.commit?.author?.date;
      if (!createdAt) {
        continue;
      }
      // Defensive re-check even though the API already filtered server-side.
      const created = new Date(createdAt);
      if (created < since || created >= until) {
        continue;
      }

      const msg = (c.commit?.message || "").toLowerCase();
      const isPublishBatch =
        (msg.startsWith("merge pull request") && msg.includes("auto publish")) ||
        msg.startsWith("merging changes synced from");

      if (isPublishBatch) {
        items.push(c);
      }
    }

    if (commits.length < perPage) {
      break;
    }

    page += 1;
  }

  return items;
}

// Expands each publish-batch commit into one row per publishable doc file.
// Each row carries its own subcategory derived from the file path so the
// report stays grouped the same way as before.
async function rowsFromPublishBatches(repo, token, sinceIso, untilIso, pathPrefixes) {
  const batches = await listPublishBatches(repo, token, sinceIso, untilIso);
  const rows = [];
  const seen = new Set();

  for (const batch of batches) {
    const createdAt = batch.commit?.committer?.date || batch.commit?.author?.date;
    if (!createdAt) {
      continue;
    }

    const details = await getCommitDetails(repo, batch.sha, token);
    const allFiles = (details.files || []).map((f) => f.filename).filter(Boolean);
    const publishableFiles = allFiles.filter((f) => isLikelyLearnPagePath(repo, f, pathPrefixes));

    for (const filePath of publishableFiles) {
      // Deduplicate: a file can appear in both a prmerger and a learn-build sync
      const dedupKey = `${repo}#${filePath}`;
      if (seen.has(dedupKey)) {
        continue;
      }
      seen.add(dedupKey);

      const msLearnUrl = toMsLearnUrl(repo, filePath);
      const sourceUrl = toGithubSourceUrl(repo, filePath);

      // Derive subcategory from the file path. Entra-docs files live under
      // docs/<section>/..., azure-docs files under articles/<section>/...,
      // so segments[1] is the section name either way. Anything that doesn't
      // match either pattern falls back to "General".
      const segments = filePath.replace(/\\/g, "/").toLowerCase().split("/").filter(Boolean);
      let subcategory = "General";
      if ((segments[0] === "docs" || segments[0] === "articles") && segments[1]) {
        subcategory = titleCase(segments[1]);
        // If the file lives in a subfolder (<root>/<section>/<subfolder>/<file>.md),
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
        title,
        fileName,
        repo,
        author: batch.commit?.committer?.name || batch.author?.login || "learn-build-service",
        publishedVia: extractPublishedVia(batch.commit?.message || ""),
        createdAt,
        commitUrl: batch.html_url,
        shortSha: batch.sha.slice(0, 7),
        msLearnUrl,
        sourceUrl
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

function buildHtml({ generatedAtIso, sinceIso, untilIso, grouped, total }) {
  const sections = Object.entries(grouped)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([subcategory, rows]) => {
      const trs = rows
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map((row) => {
          const sourceLink = row.sourceUrl ? `<a href="${esc(row.sourceUrl)}">source</a>` : "-";
          const learnLink = row.msLearnUrl ? `<a href="${esc(row.msLearnUrl)}">learn</a>` : "-";
          const commitLink = row.commitUrl ? `<a href="${esc(row.commitUrl)}">commit</a>` : "-";
          return `
            <tr>
              <td>${esc(row.title)}</td>
              <td>${esc(row.repo)}</td>
              <td>${esc(row.author)}</td>
              <td>${esc(toLocalTime(row.createdAt))}</td>
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
              <th>Title</th>
              <th>Repository</th>
              <th>Author</th>
              <th>Created (${esc(REPORT_TZ)})</th>
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
    ? "<p>No new Entra-related documentation updates were published in the last 24 hours.</p>"
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
      <div class="meta">Window: ${esc(sinceIso)} to ${esc(untilIso)} | Generated: ${esc(generatedAtIso)} | Total updates: ${total}</div>
    </div>
    <div class="content">
      ${body}
      <p class="foot">Generated automatically by GitHub Actions.</p>
    </div>
  </div>
</body>
</html>`;
}

// One item = one link (the title, pointing wherever a reader would actually
// want to click) plus a single indented meta line for everything secondary.
// No table: a GFM table's columns get resized per-client anyway, so manual
// padding buys nothing, and a fixed row shape reads cleaner than cramped
// cells in a narrow email pane.
function buildDigestItem(row) {
  const primaryUrl = row.msLearnUrl || row.sourceUrl || "";
  const extraLinks = [];
  if (row.msLearnUrl && row.sourceUrl) {
    extraLinks.push(mdLink("📄 source", row.sourceUrl));
  }
  extraLinks.push(mdLink(`🔗 ${row.shortSha}`, row.commitUrl));

  const titleLine = primaryUrl
    ? `- **[${escMd(row.title)}](${primaryUrl})**`
    : `- **${escMd(row.title)}**`;

  const metaParts = [toLocalClock(row.createdAt), escMd(row.publishedVia || row.author)];
  if (row.repo.toLowerCase() !== "microsoftdocs/entra-docs") {
    metaParts.push(row.repo.replace(/^microsoftdocs\//i, ""));
  }
  metaParts.push(...extraLinks);

  return `${titleLine}\n  ${metaParts.join(" · ")}`;
}

function buildMarkdownWindow({ grouped, total, sinceIso }) {
  const dateLabel = toLocalDateLabel(sinceIso);

  if (total === 0) {
    return [
      `**${esc(dateLabel)}** (${esc(REPORT_TZ)})`,
      "",
      "> [!NOTE]",
      "> No Entra documentation updates in this window."
    ].join("\n");
  }

  const categoryCount = Object.keys(grouped).length;
  const sections = Object.entries(grouped)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([subcategory, rows]) => {
      const items = rows
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map(buildDigestItem)
        .join("\n");

      return `## ${esc(subcategory)} · ${rows.length}\n\n${items}`;
    })
    .join("\n\n");

  const summary = `**${esc(dateLabel)}** (${esc(REPORT_TZ)}) · ${total} update${total === 1 ? "" : "s"} across ${categoryCount} area${categoryCount === 1 ? "" : "s"}`;

  return [summary, "", sections].join("\n");
}

function buildIssueBody({ primarySinceIso, primaryGrouped, primaryTotal }) {
  const body = buildMarkdownWindow({
    grouped: primaryGrouped,
    total: primaryTotal,
    sinceIso: primarySinceIso
  });

  return [body, "", "*Generated automatically by GitHub Actions.*"].join("\n");
}

async function main() {
  const githubToken = getEnv("GITHUB_TOKEN");
  if (!githubToken) {
    throw new Error("Missing GITHUB_TOKEN");
  }

  const generatedAt = new Date();
  const generatedAtIso = generatedAt.toISOString();

  const lookbackHours = Number.parseInt(getEnv("LOOKBACK_HOURS", "24"), 10);

  // Anchor the window to midnight (REPORT_TZ) of the current calendar day, with
  // an explicit upper bound at that same midnight.  This makes the window an
  // exact, non-overlapping 24h slice (yesterday midnight -> today midnight)
  // no matter when the job actually runs - a scheduled run fired late, or a
  // manual workflow_dispatch run later the same day, always reports exactly
  // the same content instead of re-including items already covered by the
  // previous day's report.
  // Note: the workflow sets TZ so Node.js local-time operations
  // (new Date(year, month, day)) resolve to REPORT_TZ midnight in UTC.
  const todayLocalStr = new Intl.DateTimeFormat("sv-SE", {
    timeZone: REPORT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(generatedAt);
  const [localYear, localMonth, localDay] = todayLocalStr.split("-").map(Number);
  const midnightTodayLocal = new Date(localYear, localMonth - 1, localDay, 0, 0, 0, 0);
  // When the lookback is a whole number of days, step back by calendar days
  // rather than subtracting fixed milliseconds, so the two DST-transition
  // days a year (23h/25h local days) don't shift the window by an hour.
  const primarySince = lookbackHours % 24 === 0
    ? new Date(localYear, localMonth - 1, localDay - lookbackHours / 24, 0, 0, 0, 0)
    : new Date(midnightTodayLocal.getTime() - lookbackHours * 60 * 60 * 1000);
  const primarySinceIso = primarySince.toISOString();
  const primaryUntilIso = midnightTodayLocal.toISOString();

  const primaryRows = [];
  for (const source of PUBLISH_SOURCES) {
    const rows = await rowsFromPublishBatches(
      source.repo,
      githubToken,
      primarySinceIso,
      primaryUntilIso,
      source.pathPrefixes
    );
    primaryRows.push(...rows);
  }
  const groupedPrimary = groupRows(primaryRows);

  const html = buildHtml({
    generatedAtIso,
    sinceIso: primarySinceIso,
    untilIso: primaryUntilIso,
    grouped: groupedPrimary,
    total: primaryRows.length
  });
  const issueBody = buildIssueBody({
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
    timeZone: REPORT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(generatedAt);

  const metadata = {
    title: `Daily Entra Docs PR Report - ${dateLabel}`,
    label: getEnv("ISSUE_LABEL", "entra-docs-report"),
    total24h: primaryRows.length,
    generatedAtIso,
    primarySinceIso,
    primaryUntilIso
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
