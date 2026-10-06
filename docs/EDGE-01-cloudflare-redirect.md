# EDGE-01 — www redirect drops the path separator

**Severity:** P1 (live customer-facing)
**Status:** Open — requires the Cloudflare dashboard. No application deploy can fix it.

## Confirmed live behaviour (verified 2026-10-05)

```
$ curl -s -o /dev/null -D - https://www.ecoauditor.io/health
HTTP/1.1 301 Moved Permanently
Location: https://ecoauditor.iohealth

$ curl -s -o /dev/null -D - "https://www.ecoauditor.io/pricing?plan=growth&billing=annual"
HTTP/1.1 301 Moved Permanently
Location: https://ecoauditor.iopricing?plan=growth&billing=annual
```

Both the path separator and the host are fused together. The query string is
preserved, so only the `"/"` before the path is missing. Every `www.` URL that
carries a path lands on a nonexistent host — `/health` becomes
`https://ecoauditor.iohealth`, which is a different registrable name entirely,
not a 404 on your site.

The apex host is unaffected:

```
$ curl https://ecoauditor.io/health
{"status":"ok","sha":"50d6191...","db":"ok", ...}
```

## Why no deploy can fix this

The 301 is emitted by Cloudflare **before** the request reaches the origin, so
`server.cjs` never sees it. Adding a redirect in the app would create a second,
competing hop rather than replacing this one.

## The fix

In **Rules → Redirect Rules → Single Redirects**, the `www` rule is almost
certainly concatenating the path without a separator — something equivalent to
`concat("https://ecoauditor.io", trim(http.request.uri.path, "/"))`, which turns
`/health` into `health` and then glues it to the host.

Replace the target with one that keeps the leading slash:

```
concat("https://ecoauditor.io", http.request.uri.path)
```

If the rule is a **Bulk Redirect** (static source/destination) rather than a
Dynamic Redirect, set:

- Source: `https://www.ecoauditor.io/*`
- Target: `https://ecoauditor.io/${1}`
- **Preserve query string: enabled**

Keep status code **301** so search engines do not reindex the `www` host.

## Verify after saving

```bash
for u in "https://www.ecoauditor.io/" \
         "https://www.ecoauditor.io/health" \
         "https://www.ecoauditor.io/pricing?plan=growth&billing=annual" \
         "https://www.ecoauditor.io/blog"; do
  echo "== $u"
  curl -s -o /dev/null -D - --max-time 20 "$u" | grep -iE '^(HTTP/|location:)'
done
```

Expected — note the slash, and the query string intact on the third case:

```
Location: https://ecoauditor.io/
Location: https://ecoauditor.io/health
Location: https://ecoauditor.io/pricing?plan=growth&billing=annual
Location: https://ecoauditor.io/blog
```

Then follow one redirect end to end to confirm the destination serves 200:

```bash
curl -sL -o /dev/null -w '%{http_code} %{url_effective}\n' https://www.ecoauditor.io/health
```

---

## Deployment traceability (found while verifying the above)

While checking the live `/health` response, the reported build SHA was
`50d6191`, while this repository's `master` was at `1374329` and
`50d6191` did not exist locally at all.

`git fetch --all --prune` resolved it: PR #36 had been merged and deployed
during the session, advancing both `main` and `master` to `50d6191`, and
consuming the remote `fix/full-audit-20261005` branch (GitHub deletes a branch
on merge).

**This is not a defect, but it is worth knowing:** the live SHA was briefly
untraceable to any local ref. When reconciling an audit against production,
fetch first — `/health` can be ahead of a local clone by a whole PR. Any
report that pins an `audited_live_sha` should re-verify that SHA against the
live endpoint at the moment of writing, not against a local branch head.