---
name: Session cookies in Replit preview iframe
description: Why session auth fails in the Replit preview and how to configure the cookie
---

## Problem
Session-based auth (express-session) appears to log in (POST /login returns 200,
Set-Cookie present) but the very next request (/auth/me) returns 401 — an apparent
"login redirect loop." curl tests pass; only the browser fails.

## Root cause
The Replit preview pane embeds the app in an **iframe**. Browsers treat cookies in
an iframe as third-party. With `SameSite=Lax` (or `Strict`), the browser refuses to
send the cookie on requests inside the iframe, so the server never sees the session.

## Fix
Cookie must be:
```
cookie: { httpOnly: true, secure: true, sameSite: "none", maxAge: ... }
```
`SameSite=None` is required for the iframe (third-party) context; it mandates
`Secure=true`. Replit serves both the dev preview and production over HTTPS, so
`secure: true` works in both. Also set `app.set("trust proxy", 1)` so Express honors
`X-Forwarded-Proto` from the proxy.

**Why:** `SameSite=None; Secure` is the only combination browsers send inside a
cross-site iframe.

## Testing gotcha
With `secure: true`, curl over plain HTTP (`localhost:80`) will NOT receive the
cookie. Test over HTTPS instead: `curl https://$REPLIT_DEV_DOMAIN/api/...`.

## Also recommended
Use a persistent session store (connect-pg-simple on the existing Postgres, table
`session`) instead of the default in-memory store — esbuild-based servers rebuild on
file changes and wipe in-memory sessions.
