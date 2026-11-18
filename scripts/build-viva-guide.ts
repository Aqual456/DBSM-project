import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

/**
 * Converts docs/viva/ReliefFlow-Viva-Guide.md into a styled, printable HTML and an A4 PDF.
 * A deliberately small Markdown renderer (headings, paragraphs, lists, tables, code, quotes,
 * bold/italic/inline code) so no extra dependency is needed.
 */
const SRC = resolve("docs/viva/ReliefFlow-Viva-Guide.md");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s: string) =>
  esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,:;!?]|$)/g, "$1<em>$2</em>");

function render(md: string) {
  const lines = md.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  const toc: { id: string; text: string }[] = [];
  let i = 0;
  const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) {
      const level = h[1].length;
      const id = slug(h[2]);
      if (level === 2) toc.push({ id, text: h[2] });
      out.push(`<h${level} id="${id}">${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^---+$/.test(l.trim())) {
      out.push("<hr/>");
      i++;
      continue;
    }
    if (l.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
        i++;
      }
      const body = rows.filter((r) => !r.every((c) => /^:?-+:?$/.test(c)));
      const [head, ...rest] = body;
      const isEmptyHead = head.every((c) => !c);
      out.push(
        `<table>${isEmptyHead ? "" : `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>`}<tbody>${rest
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`,
      );
      continue;
    }
    if (l.startsWith("> ")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }
    if (/^\s*[*-]\s+/.test(l) || /^\d+\.\s+/.test(l)) {
      const ordered = /^\d+\.\s+/.test(l);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\d+\.\s+/.test(lines[i]) : /^\s*[*-]\s+/.test(lines[i]))) {
        items.push(lines[i].replace(ordered ? /^\d+\.\s+/ : /^\s*[*-]\s+/, ""));
        i++;
      }
      out.push(`<${ordered ? "ol" : "ul"}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    if (!l.trim()) {
      i++;
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||```|> |\s*[*-]\s|\d+\.\s|---)/.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return { html: out.join("\n"), toc };
}

async function main() {
  const { html, toc } = render(readFileSync(SRC, "utf8"));
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ReliefFlow Viva Guide</title>
<style>
  @page { size: A4; margin: 16mm 14mm 18mm; }
  :root { --ink:#172033; --muted:#55627a; --line:#dbe2ec; --accent:#2563eb; --teal:#0f9d8a; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: var(--ink); font-size: 10.5pt; line-height: 1.55; max-width: 980px; margin: 0 auto; padding: 24px; background:#fff; }
  h1 { font-size: 24pt; margin: 0 0 6px; color:#0f1e3d; letter-spacing:-.02em; }
  h2 { font-size: 15pt; margin: 26px 0 8px; padding-top: 8px; border-top: 2px solid var(--accent); color:#0f1e3d; break-after: avoid; }
  h3 { font-size: 12pt; margin: 18px 0 6px; color: var(--teal); break-after: avoid; }
  p { margin: 6px 0; }
  ul, ol { margin: 6px 0 6px 20px; padding: 0; }
  li { margin: 2px 0; }
  code { font-family: Consolas, "Cascadia Code", monospace; font-size: 9pt; background: #f1f5f9; padding: 1px 4px; border-radius: 4px; }
  pre { background: #0f1a2c; color: #e2e8f0; padding: 10px 12px; border-radius: 8px; overflow-x: auto; break-inside: avoid; }
  pre code { background: none; color: inherit; padding: 0; font-size: 8.8pt; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 9.3pt; break-inside: auto; }
  th { text-align: left; background: #eef3fb; color: #0f1e3d; font-weight: 650; }
  th, td { border: 1px solid var(--line); padding: 5px 7px; vertical-align: top; }
  tr { break-inside: avoid; }
  blockquote { margin: 10px 0; padding: 10px 14px; background: #f0fdfa; border-left: 4px solid var(--teal); border-radius: 6px; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 18px 0; }
  .toc { columns: 2; font-size: 9.5pt; margin: 10px 0 0; padding: 12px 16px; background: #f8fafc; border: 1px solid var(--line); border-radius: 8px; }
  .toc a { color: var(--ink); text-decoration: none; display: block; padding: 1px 0; }
  .cover-sub { color: var(--muted); margin-bottom: 8px; }
</style></head><body>
<h1>ReliefFlow — Complete Project &amp; Viva Guide</h1>
<div class="cover-sub">Disaster relief &amp; resource allocation platform · DBMS project · generated ${new Date().toLocaleDateString("en-IN", { dateStyle: "long" })}</div>
<nav class="toc">${toc.map((t) => `<a href="#${t.id}">${esc(t.text)}</a>`).join("")}</nav>
${html.replace(/^<h1[^>]*>.*?<\/h1>/, "")}
</body></html>`;
  const htmlFile = resolve("docs/viva/ReliefFlow-Viva-Guide.html");
  writeFileSync(htmlFile, page);
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
  try {
    const p = await browser.newPage();
    await p.setContent(page, { waitUntil: "load" });
    await p.pdf({
      path: htmlFile.replace(".html", ".pdf"),
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="font-size:8px;color:#64748b;width:100%;text-align:center">ReliefFlow Viva Guide · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
      margin: { top: "16mm", bottom: "18mm", left: "14mm", right: "14mm" },
    });
  } finally {
    await browser.close();
  }
  console.log("Wrote", htmlFile, "and PDF");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
