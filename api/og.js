/**
 * Generic OG meta injector for other dynamic pages.
 * Usage: /api/og?title=...&description=...&url=...
 */
import { readFileSync } from "fs";
import { join } from "path";

export default function handler(req, res) {
  const { title, description, url } = req.query;
  let html;
  try {
    html = readFileSync(join(process.cwd(), "dist", "index.html"), "utf-8");
  } catch {
    html = `<!DOCTYPE html><html><head><title>${title || "مِشوار"}</title></head><body></body></html>`;
  }
  if (title) {
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
    html = html.replace(/(<meta property="og:title" content=")[^"]*"/, `$1${title}"`);
    html = html.replace(/(<meta name="twitter:title" content=")[^"]*"/, `$1${title}"`);
  }
  if (description) {
    html = html.replace(/(<meta name="description" content=")[^"]*"/, `$1${description}"`);
    html = html.replace(/(<meta property="og:description" content=")[^"]*"/, `$1${description}"`);
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=300");
  res.status(200).send(html);
}
