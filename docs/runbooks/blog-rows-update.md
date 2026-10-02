# Runbook: correct the live blog rows (owner)

Findings: F-A-04, F-R5-01, F-R5-02 (the four seeded posts), F-A-19 (three autoblog posts).
Prepared by fix run FIX-RUN-20260930-q4d8 on 2026-09-30. **Nothing in this runbook has been run against production.** Every step below is yours to run, in this order:

1. **Export** the current rows (this is your backup and your rollback).
2. **Apply** the corrections: the SQL file for the four seeded posts, `/api/publish` for the three autoblog posts.
3. **Verify** the live API and the live pages.

## Why the code change alone did not fix production

- The four seeded posts (`sb-253-compliance-guide-smb`, `ghg-protocol-scope-3-guide-smb`, `carbon-accounting-software-smb-guide`, `cbam-supply-chain-guide-smb`) sell features that do not exist (supplier surveys, CBAM data packs, CDP/GRI/TCFD exports, DEFRA factors), misstate SB 253 and CBAM, and the carbon-accounting post and its FAQ JSON-LD still say Starter is `$49/month` while `/pricing` says `$149`.
- The corrected text is in `seedBlogPosts()` in `server.cjs`, but that function only runs when `blog_posts` is empty and inserts with `ON CONFLICT (slug) DO NOTHING`. It never updates a live row. That is why the `$49` to `$149` seed fix of 2026-08-22 never reached the live post.
- So the live rows must be changed in the database, by you, once.

## Before you start

- You need: the production database connection string (from your secret store) and `SITE_DEPLOY_TOKEN` (the Railway variable behind `POST /api/publish`). Both appear below only as environment variables. Never paste either into a file, a ticket or a chat.
- You need `psql` on the machine you run this from.
- **Do this before the new image is deployed.** The server-rendered blog (`/blog/`, `/blog/<slug>/` and `sitemap.xml`) ships with the image of this change set and is live only once that image is deployed. That server renders the stored rows exactly as written, the retracted claims in their body and FAQ included, so deploying it first would put those claims on crawlable pages. In [release-order.md](release-order.md) this runbook is step 2 and the deploy is step 5.
- Blog API responses are cached for 60 seconds (`Cache-Control: public, max-age=60`). Once that image is live, the blog pages and `sitemap.xml` read the same rows at most once a minute (a successful `/api/publish` refreshes them at once), so rows you change with the SQL below show up within a minute and there is nothing to rebuild or redeploy.
- **Check CARB first.** The SB 253 text is dated "as of September 29, 2026" and says CARB's regulation was still awaiting approval from California's Office of Administrative Law. Open the CARB program page (link in the post) on the day you run this. If OAL has acted, change those two sentences (body and FAQ) in `docs/runbooks/blog-rows-update.sql` before you run it.

PowerShell examples first, bash equivalents where they differ:

```powershell
$env:DATABASE_URL = '<production connection string, from your secret store>'
$env:SITE_DEPLOY_TOKEN = '<deploy token, from the Railway variables tab>'
$slugs = 'sb-253-compliance-guide-smb','ghg-protocol-scope-3-guide-smb','carbon-accounting-software-smb-guide','cbam-supply-chain-guide-smb'
$autoblog = 'carbon-auditing-guide','carbon-audit-report','esg-software-selection-guide'
```

```bash
export DATABASE_URL='<production connection string, from your secret store>'
export SITE_DEPLOY_TOKEN='<deploy token, from the Railway variables tab>'
```

## 1. Export the rows first

Do both. The API copy is quick to read. The database copy is the exact stored value and is what the rollback uses.

**a. From the public API (read-only, one JSON file per post):**

```powershell
foreach ($s in $slugs + $autoblog) {
  Invoke-RestMethod "https://ecoauditor.io/api/blog-posts/$s" | ConvertTo-Json -Depth 10 |
    Set-Content "blog-backup-$s.json" -Encoding utf8
}
```

**b. From the database (slug, body_html, faq and the other columns the SQL touches):**

```powershell
psql $env:DATABASE_URL -c "\copy (SELECT slug, title, meta_title, meta_description, body_html, faq, internal_links, external_links, cta, published_at FROM blog_posts WHERE slug IN ('sb-253-compliance-guide-smb','ghg-protocol-scope-3-guide-smb','carbon-accounting-software-smb-guide','cbam-supply-chain-guide-smb') ORDER BY slug) TO 'blog-rows-backup.csv' CSV HEADER"
```

Check that `blog-rows-backup.csv` has 4 data rows before you go on. Keep both exports somewhere safe; they contain no secrets, but they are your only copy of the old text.

## 2a. The four seeded posts: run the SQL file

```powershell
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f docs/runbooks/blog-rows-update.sql
```

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/runbooks/blog-rows-update.sql
```

What it does:

- Runs in one transaction (`BEGIN` ... `COMMIT`).
- Sets `meta_description`, `body_html`, `faq` and `external_links` on the four rows, matched by `slug`. It does not touch `title`, `meta_title` or `published_at`.
- Ends with a check that raises an error if it does not find all four rows, or if any of them still contains a phrase the audit found false (`$49`, `DEFRA`, `quarterly`, `2028`, `$2 billion`, `you are in scope`, `CBAM data pack`, `Supply chain surveys`, `CDP, GRI, TCFD`, the dead CARB URL). An error stops `psql` before `COMMIT`, so nothing is changed.
- On success you see four `UPDATE 1` results (each printing its slug) and `COMMIT`.

Why SQL and not `/api/publish` for these four: `/api/publish` also overwrites `meta_title` with the title and resets `published_at`, and it cannot change `external_links`, and the SB 253 post has a dead CARB link (a 404 on 2026-09-30) that the SQL replaces with CARB's current program page.

If you prefer `/api/publish` anyway, it now updates the FAQ as well (a post that carries `faq` replaces the stored one; a post without `faq` leaves it alone). Send each post's original `publishDate`, and expect `meta_title` to become the title and the dead link to stay.

## 2b. The three autoblog posts (F-A-19): republish through `/api/publish`

These rows were created by `/api/publish`, have no FAQ, and their text is not in the repository. Each needs one sentence corrected. The replacement text was checked against the sources named below on 2026-09-30, except where marked.

| Post | Live sentence (exact) | Replace with |
|---|---|---|
| `carbon-auditing-guide` | `Under the European Sustainability Reporting Standards (ESRS), companies are required to obtain limited assurance on their sustainability reporting, with the first reports under CSRD expected for the 2024 financial year for the first wave of eligible companies.` | `The Corporate Sustainability Reporting Directive (CSRD) requires the sustainability information that companies report, using the European Sustainability Reporting Standards (ESRS), to be independently assured (limited assurance). The first reports under CSRD covered the 2024 financial year for the first wave of companies. Following the EU's Omnibus I simplification, CSRD applies only to companies with more than 1,000 employees and more than 450 million euros in net annual turnover, so check whether it applies to you.` |
| `carbon-audit-report` | `Without a verified audit report, a company cannot set a science-based target.` | `A quantified emissions baseline is the starting point for setting a science-based target; check the SBTi's current criteria for exactly what it requires before you submit.` |
| `esg-software-selection-guide` | `maintains an immutable audit trail for regulatory bodies like the CSRD.` | `maintains an immutable audit trail that supports assurance of the reporting required under regulations such as the CSRD.` |

Sources and caveats:

- Row 1: the assurance duty comes from the CSRD (a directive), not from the ESRS (the reporting standards). The Omnibus I thresholds (more than 1,000 employees and more than 450 million euros) come from the European Parliament press release of 2025-12-16. The reviewer could not fetch EUR-Lex, so **confirm the thresholds on EUR-Lex before you publish**.
- Row 2: the audit could not verify the original claim (the SBTi criteria were not fetched), so the replacement drops it and points readers to the SBTi's criteria instead of asserting a rule.
- Row 3: the CSRD is a directive, not a regulatory body.

Republish each corrected body (this fetches the live row, replaces the sentence, and stops if the sentence is not found exactly, which means it was already fixed or the wording changed):

```powershell
$fixes = @(
  @{ slug = 'carbon-auditing-guide';
     find = 'Under the European Sustainability Reporting Standards (ESRS), companies are required to obtain limited assurance on their sustainability reporting, with the first reports under CSRD expected for the 2024 financial year for the first wave of eligible companies.';
     replace = "The Corporate Sustainability Reporting Directive (CSRD) requires the sustainability information that companies report, using the European Sustainability Reporting Standards (ESRS), to be independently assured (limited assurance). The first reports under CSRD covered the 2024 financial year for the first wave of companies. Following the EU's Omnibus I simplification, CSRD applies only to companies with more than 1,000 employees and more than 450 million euros in net annual turnover, so check whether it applies to you." },
  @{ slug = 'carbon-audit-report';
     find = 'Without a verified audit report, a company cannot set a science-based target.';
     replace = "A quantified emissions baseline is the starting point for setting a science-based target; check the SBTi's current criteria for exactly what it requires before you submit." },
  @{ slug = 'esg-software-selection-guide';
     find = 'maintains an immutable audit trail for regulatory bodies like the CSRD.';
     replace = 'maintains an immutable audit trail that supports assurance of the reporting required under regulations such as the CSRD.' }
)
foreach ($f in $fixes) {
  $post = (Invoke-RestMethod "https://ecoauditor.io/api/blog-posts/$($f.slug)").post
  $occurrences = ([regex]::Matches($post.body_html, [regex]::Escape($f.find))).Count
  if ($occurrences -ne 1) { throw "$($f.slug): expected the sentence once, found $occurrences. Stop and compare with the export." }
  $payload = @{ posts = @(@{
    slug = $post.slug; title = $post.title; description = $post.meta_description
    body = $post.body_html.Replace($f.find, $f.replace); bodyFormat = 'html'
    publishDate = $post.published_at; tags = @($post.primary_keyword)
  }) } | ConvertTo-Json -Depth 6
  Invoke-RestMethod 'https://ecoauditor.io/api/publish' -Method Post -ContentType 'application/json; charset=utf-8' `
    -Headers @{ Authorization = "Bearer $env:SITE_DEPLOY_TOKEN" } -Body ([System.Text.Encoding]::UTF8.GetBytes($payload))
}
```

Each call must answer `success: true`, `status: published`, and `deployed` containing the slug. `publishDate` and `tags` are sent back unchanged on purpose: `/api/publish` overwrites `published_at` and `primary_keyword`, so leaving them out would reorder the blog and replace the keyword with the title. The body is sent as UTF-8 bytes because these posts contain typographic dashes and Windows PowerShell 5.1 would otherwise mangle them.

## 3. Verify the live API and the live pages

**API: none of the audit's phrases remain in any of the seven rows.**

```powershell
$bad = '\$49|DEFRA|quarterly|2028|\$2 ?billion|you are in scope|CBAM data pack|Supply chain surveys|CDP, GRI, TCFD|plus the emissions from electricity|must purchase CBAM certificates|climate-corporate-data-accountability'
foreach ($s in $slugs) {
  $text = Invoke-RestMethod "https://ecoauditor.io/api/blog-posts/$s" | ConvertTo-Json -Depth 10
  if ($text -match $bad) { "$s STILL CONTAINS: $($Matches[0])" } else { "$s clean" }
}
foreach ($s in $autoblog) {
  $text = (Invoke-RestMethod "https://ecoauditor.io/api/blog-posts/$s").post.body_html
  if ($text -match 'ESRS\), companies are required|cannot set a science-based target|regulatory bodies like the CSRD') { "$s STILL WRONG" } else { "$s clean" }
}
```

Bash: `curl -s https://ecoauditor.io/api/blog-posts/<slug> | grep -Ei '\$49|DEFRA|quarterly|2028'` must print nothing.

**Numbers to check by eye on the carbon-accounting post:** Starter `$149`, Growth `$399`, Pro `$999` per month, the same as the live `/pricing` page, in the body and in the FAQ answer.

**Pages (in a browser, after a minute for the cache):**

- Open `/blog/<slug>` for each of the four seeded slugs. The FAQ section at the bottom shows the corrected answers.
- The FAQ structured data is built in the browser from the same `faq` column. In the browser console on the carbon-accounting post, this must print `false`: `[...document.querySelectorAll('script[type="application/ld+json"]')].some(s => s.textContent.includes('FAQPage') && s.textContent.includes('$49'))`.
- On the SB 253 post, the CARB link now opens CARB's program page instead of a 404.

Write down the date you ran this and who ran it.

## Rollback

Restore from the database export (step 1b). In `psql`:

```sql
BEGIN;
CREATE TEMP TABLE blog_backup (slug text, title text, meta_title text, meta_description text, body_html text, faq jsonb, internal_links jsonb, external_links jsonb, cta jsonb, published_at timestamptz);
\copy blog_backup FROM 'blog-rows-backup.csv' CSV HEADER
UPDATE blog_posts b SET meta_description = t.meta_description, body_html = t.body_html, faq = t.faq, external_links = t.external_links FROM blog_backup t WHERE b.slug = t.slug;
COMMIT;
```

For the three autoblog posts, republish the old body from `blog-backup-<slug>.json` the same way as in step 2b. Rolling back puts the false claims back on the live site, so only do it if the new text turns out to be wrong.

## After this: what still has to happen (not part of this run)

- Delete `seedBlogPosts()` from `server.cjs` and this runbook's SQL file. The seed is a second source of truth that has already diverged from the database once; once the live rows are correct there is nothing left for it to do.
- Run any future blog claims gate on both write paths (the seed bypasses `server-publish.cjs`, so a gate placed only there does not cover it).
- The autoblog posts have anchor tags without links (the publish sanitizer strips attributes) and no FAQ. That is a separate finding, not handled here.
