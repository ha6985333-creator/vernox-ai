---
name: Vernox AI Design System
description: Established color palette, font, radius, and CSS conventions for all frontend pages
---

## Color palette (CSS variables)
- `--primary: #1a1a1a` — backgrounds, sidebar, hero sections
- `--secondary: #4f46e5` — accent/CTA (indigo)
- `--secondary-dark: #3730a3` — accent hover
- `--neutral / --muted: #6b7280` — secondary text
- `--alert: #dc2626` — errors
- `--success: #16a34a` — confirmations
- `--bg: #ffffff`, `--bg-subtle: #f9fafb`, `--border: #e5e7eb`

## Typography
- Font: Inter (Google Fonts `wght@400;500;600;700`) — imported in every CSS file
- All `body` font-family declarations updated to `'Inter', -apple-system, ...`
- `@import` must be the VERY FIRST line in any CSS file — before `:root` or any other rule

## Spacing & radius
- Max border-radius: 6–8px everywhere (was 14–20px before)
- No `box-shadow` on cards — use `border: 1px solid var(--border)` instead
- No `backdrop-filter: blur`, no `linear-gradient` backgrounds

## Files updated
- `artifacts/main-site/public/landing.css` — full rewrite (authoritative source)
- `artifacts/main-site/index.html` — 3 feature cards, no Enterprise tier, dark hero
- `artifacts/main-site/public/style.css` — chat widget, dark `.page-bg: #1a1a1a`
- `artifacts/main-site/portal/index.html` — sidebar `#1a1a1a`, inline CSS patched
- `artifacts/main-site/admin/index.html` — sidebar `#1a1a1a`, inline CSS patched
- `artifacts/main-site/login.html` — dark `#1a1a1a` background, clean white card

**Why:** User explicitly requested Stripe/Linear/Vercel aesthetic — no gradients, no blur, no shadows, max 5 colors, Inter font, consistent 6px radius.
