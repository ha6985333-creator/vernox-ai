---
name: Admin table XSS guard
description: How to safely render user-supplied data in the static admin/portal dashboards
---

The admin dashboard (`artifacts/main-site/admin/index.html`) and similar static pages render rows from API data with a small `esc()` helper.

**The trap:** `esc()` only escapes `&`, `<`, `>` — NOT quotes (`"`, `'`). So interpolating user-supplied fields into HTML attribute contexts (`href="mailto:${...}"`, `value="..."`) or inline event handlers (`onchange="fn('${...}')"`) via `innerHTML` is a stored-XSS hole: a quote in the data breaks out of the attribute. Any public endpoint that accepts free-text (e.g. `/api/buy` phone/name) can plant the payload, which fires when an admin views the table.

**The rule:** for any table fed by user-supplied data, build DOM nodes and set user values with `textContent` / element properties (`.href = "mailto:" + encodeURIComponent(x)`) and wire actions with `addEventListener`. Do NOT interpolate user data into `innerHTML` strings, attributes, or inline `on*` handlers. HTML-entity escaping is also insufficient for inline-handler contexts because the HTML parser decodes entities before the JS runs.

**Why:** the Sale Requests table originally used the `innerHTML` + `esc()` pattern and a code review flagged it as a blocking stored-XSS vector. Defense-in-depth: also constrain free-text fields server-side (e.g. phone regex in `lib/db/src/schema/purchases.ts`).
