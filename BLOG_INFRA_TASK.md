# Task: Add Blog Infrastructure to eco-auditor and leanforge repos

## Context
Two portfolio sites are missing blog routes, which blocks the SEO AI Regent multi-site publishing pipeline from delivering posts to them. The `/api/publish` endpoint is already scaffolded in both repos. We need the front-end blog pages and content directories to exist so published posts render publicly.

## Site 1: eco-auditor (Express + React Router)

**Repo:** `cousined1/eco-auditor`
**Domain:** `ecoauditor.io`
**Framework:** Express backend + React Router (NOT Next.js)

### What exists
- `/api/publish` endpoint at `src/pages/api/publish.ts` (already scaffolded)
- Writes posts to `src/content/blog/` as markdown files with frontmatter
- Homepage, `/pricing`, `/methodology`, `/sample-report`, `/security`, `/demo`, `/contact` all live

### What's missing
- No `/blog` route in the Express app
- No `src/content/blog/` directory
- No blog index page
- No blog post detail page at `/blog/:slug`
- No sitemap entry for `/blog`

### Tasks
1. Create `src/content/blog/` directory with a `.gitkeep`
2. Add a blog index route handler in Express that:
   - Reads all `.md` files from `src/content/blog/`
   - Parses frontmatter (use `gray-matter`)
   - Renders a blog index page listing posts (title, date, description, link)
   - Served at `GET /blog`
3. Add a blog post detail route at `GET /blog/:slug` that:
   - Reads `src/content/blog/{slug}.md`
   - Parses frontmatter + body
   - Renders the post with proper meta tags (title, description, canonical URL, OG tags)
   - Returns 404 if slug not found
4. Add `/blog` and individual post URLs to the sitemap generator
5. Add a "Blog" link to the site navigation header/footer
6. Install `gray-matter` if not already in dependencies
7. Style the blog pages to match the existing site design (carbon accounting theme — green/blue, clean, professional)
8. Commit and push to `main` (triggers Railway redeploy)

### Post frontmatter format (for reference)
```yaml
---
slug: "csrd-compliance-checklist-2026"
title: "CSRD Compliance Checklist for 2026"
description: "What SMBs need to prepare..."
category: "Compliance"
tags: ["CSRD", "carbon accounting", "ESG"]
author: "Eco-Auditor AI"
publishDate: "2026-07-21T07:00:00Z"
canonicalUrl: "https://ecoauditor.io/blog/csrd-compliance-checklist-2026"
structuredData:
  type: "NewsArticle"
  publisher: "Eco-Auditor"
---
# Markdown body...
```

---

## Site 2: leanforge (Next.js or similar SPA)

**Repo:** `cousined1/leanforge`
**Domain:** `lean-forge.net`
**Framework:** Next.js (or similar React SPA with SSR)

### What exists
- `/api/publish` endpoint scaffolded at `keyword-trend-api/src/routes/publish.ts`
- Tool pages: `/tools/keyword-volume-checker`, `/tools/trending-keywords`, etc.
- Marketing pages: `/features`, `/pricing`, `/api-docs`, `/help-center`, `/faq`

### What's missing
- No `/blog` route or page
- No `content/blog/` directory
- No blog index page
- No blog post detail page at `/blog/:slug`
- No sitemap entry for `/blog`

### Tasks
1. Create `content/blog/` directory with a `.gitkeep`
2. Create a blog index page at `/blog` that:
   - Reads all `.md` files from `content/blog/`
   - Parses frontmatter (use `gray-matter` or `remark`)
   - Lists posts with title, date, description, and link to full post
   - Matches the existing site design (keyword trend intelligence theme — dark/professional, data-focused)
3. Create a blog post detail page at `/blog/[slug]` that:
   - Reads `content/blog/{slug}.md`
   - Renders markdown to HTML with proper styling
   - Sets meta tags: title, description, canonical URL, OG tags, JSON-LD structured data
   - Returns 404 if slug not found
4. Add `/blog` and individual post URLs to the sitemap
5. Add a "Blog" link to the site navigation
6. Install dependencies if needed (`gray-matter`, `remark`, `remark-html` or equivalent)
7. Commit and push to `main` (triggers Railway redeploy)

### Post frontmatter format (for reference)
```yaml
---
slug: "micro-saas-blueprint-niche-tools-2026"
title: "Micro-SaaS Blueprint: Niche Tools in 90 Days"
description: "How to validate, build, and launch..."
category: "Indie Hacking"
tags: ["micro-SaaS", "bootstrap", "product validation"]
author: "Lean Forge AI"
publishDate: "2026-07-21T07:00:00Z"
canonicalUrl: "https://lean-forge.net/blog/micro-saas-blueprint-niche-tools-2026"
structuredData:
  type: "NewsArticle"
  publisher: "LeanForge"
---
# Markdown body...
```

---

## Acceptance Criteria

- [ ] `ecoauditor.io/blog` returns 200 with a list of blog posts (or empty state if no posts yet)
- [ ] `ecoauditor.io/blog/:slug` renders individual posts
- [ ] `lean-forge.net/blog` returns 200 with a list of blog posts (or empty state)
- [ ] `lean-forge.net/blog/:slug` renders individual posts
- [ ] Both sites' sitemaps include `/blog` and post URLs
- [ ] Both sites have a "Blog" link in navigation
- [ ] Content directories exist and are git-tracked
- [ ] Changes committed and pushed to `main` on both repos
- [ ] Railway redeploys successfully (verify homepage still 200 after push)

## Notes
- The `/api/publish` endpoint in each repo already writes markdown files to the content directory. The blog pages just need to read and render those files.
- Use the existing site's design system/components — don't create a separate blog theme.
- These are content sites, not complex apps. Keep the blog routes simple: read directory, parse markdown, render HTML.
- If the framework uses SSR/SSG, make sure blog pages are statically generated or server-rendered (not client-only) for SEO.