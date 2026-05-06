/**
 * Generic OG meta injector for arbitrary dynamic pages.
 *
 *   /api/og?title=...&description=...&url=...
 *
 * SECURITY:
 * Query parameters are user-controlled and reflected into HTML. EVERY
 * substitution MUST go through esc() — never write a query param to the
 * response body without HTML-attribute-safe escaping. The earlier version
 * of this file did naked replace() and was a textbook reflected-XSS
 * vulnerability (see audit C-02).
 *
 * Length caps are also enforced so an attacker cannot blow up the
 * response with megabyte payloads.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { rateLimit } from "./_rate-limit.js";

const TITLE_MAX = 200;
const DESC_MAX  = 400;
const URL_MAX   = 500;

// HTML attribute-safe escape. All five characters that can break an
// HTML attribute context are replaced. This is the same routine used
// in api/trip.js — keep them in sync.
function esc(input) {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Strip control characters that could survive escaping but break the
// rendered tooltip / preview card anyway (NUL, line breaks inside attr).
function clean(input, max) {
  return String(input ?? "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .slice(0, max)
    .trim();
}

function getIndexHtml() {
  try {
    return readFileSync(join(process.cwd(), "dist", "index.html"), "utf-8");
  } catch {
    return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>مِشوار</title></head><body><div id="root"></div></body></html>`;
  }
}

// Replace existing meta or insert before </head>. Always uses esc().
function setMeta(html, attr, attrVal, contentVal) {
  const safeContent = esc(contentVal);
  const safeAttrVal = esc(attrVal);
  const re = new RegExp(`<meta\\s+${attr}="${safeAttrVal}"[^>]*>`, "i");
  if (re.test(html)) {
    return html.replace(re, `<meta ${attr}="${safeAttrVal}" content="${safeContent}" />`);
  }
  return html.replace("</head>", `<meta ${attr}="${safeAttrVal}" content="${safeContent}" />\n</head>`);
}

export default function handler(req, res) {
  // Rate limit per-IP. /api/og is a low-cost endpoint but reflects
  // user-controlled query into the response — keeping the cap tight
  // limits the value of any future XSS-class issue from being scaled.
  if (!rateLimit(req, res, { max: 30, windowMs: 60_000, keyPrefix: "og:" })) {
    return;
  }

  const title       = clean(req.query.title, TITLE_MAX);
  const description = clean(req.query.description, DESC_MAX);
  const url         = clean(req.query.url, URL_MAX);

  let html = getIndexHtml();

  if (title) {
    // Note: the regex matches the existing <title>...</title>; the
    // replacement value is escaped so even a payload containing
    // </title><script> is rendered as text inside the title element.
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
    html = setMeta(html, "property", "og:title",      title);
    html = setMeta(html, "name",     "twitter:title", title);
  }
  if (description) {
    html = setMeta(html, "name",     "description",        description);
    html = setMeta(html, "property", "og:description",     description);
    html = setMeta(html, "name",     "twitter:description", description);
  }
  if (url) {
    html = setMeta(html, "property", "og:url", url);
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.status(200).send(html);
}
