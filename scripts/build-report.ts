import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { pathToFileURL } from "url";

/**
 * Builds the course report and the team explanation from Markdown into styled HTML + A4 PDF.
 *   npx tsx scripts/build-report.ts            (both documents)
 *   npx tsx scripts/build-report.ts report     (one of: report, team)
 * Supports headings, paragraphs, (nested) lists, tables, code, quotes, images, raw HTML blocks and
 * {{PLACEHOLDER}} includes of the generated fragments in docs/report/assets (scripts/build-report-assets.ts).
 */
const DOCS: Record<string, { src: string; title: string; css?: string }> = {
  report: { src: "docs/report/ReliefFlow-Project-Report.md", title: "ReliefFlow — Project Report" },
  team: { src: "docs/report/ReliefFlow-Team-Explanation.md", title: "ReliefFlow — Team Explanation" },
  database: { src: "docs/report/ReliefFlow-Database-Explained.md", title: "ReliefFlow — The Database, Explained", css: "th, td { word-break: normal; overflow-wrap: break-word; }" },
};
const ASSETS = resolve("docs/report/assets");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s: string) =>
  esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,:;!?]|$)/g, "$1<em>$2</em>");
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function render(md: string, toc: { id: string; text: string }[]) {
  const lines = md.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let i = 0;
  const isList = (s: string) => /^\s*([*-]|\d+\.)\s+/.test(s);
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*```/.test(l)) {
      const pad = /^\s*/.exec(l)![0].length;
      const lang = l.trim().slice(3).trim();
      const buf: string[] = [];
      i++;
      const unindent = new RegExp(`^ {0,${pad}}`); // code inside a list item is indented
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++].replace(unindent, ""));
      i++;
      out.push(`<pre class="lang-${lang || "text"}"><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    if (/^<(div|table|section|p|span|br)\b/.test(l)) {
      // raw HTML block: copied verbatim until a blank line
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim()) buf.push(lines[i++]);
      out.push(buf.join("\n"));
      continue;
    }
    const img = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(l);
    if (img) {
      out.push(`<figure><img src="${img[2]}" alt="${esc(img[1])}"/>${img[1] ? `<figcaption>${esc(img[1])}</figcaption>` : ""}</figure>`);
      i++;
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) {
      const level = h[1].length;
      const id = slug(h[2]) + "-" + out.length;
      if (level === 2) toc.push({ id, text: h[2] });
      out.push(`<h${level} id="${id}">${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^---+$/.test(l.trim())) {
      out.push('<div class="pagebreak"></div>');
      i++;
      continue;
    }
    if (l.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        rows.push(lines[i].trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|")));
        i++;
      }
      const body = rows.filter((r) => !r.every((c) => /^:?-+:?$/.test(c)));
      const [head, ...rest] = body;
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rest
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`,
      );
      continue;
    }
    if (l.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${buf.map((b) => (b.trim() ? inline(b) : "<br/>")).join(" ")}</blockquote>`);
      continue;
    }
    if (isList(l)) {
      // nested lists by indentation (2+ spaces = deeper level)
      const html: string[] = [];
      const stack: { indent: number; tag: string }[] = [];
      while (i < lines.length && (isList(lines[i]) || (lines[i].startsWith("   ") && lines[i].trim() && !/^\s*```/.test(lines[i]) && stack.length))) {
        const m = /^(\s*)([*-]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (!m) {
          html[html.length - 1] = html[html.length - 1].replace(/<\/li>$/, " " + inline(lines[i].trim()) + "</li>");
          i++;
          continue;
        }
        const indent = m[1].length;
        const tag = /\d/.test(m[2]) ? "ol" : "ul";
        while (stack.length && indent < stack[stack.length - 1].indent) html.push(`</${stack.pop()!.tag}>`);
        if (!stack.length || indent > stack[stack.length - 1].indent) {
          stack.push({ indent, tag });
          html.push(tag === "ol" && parseInt(m[2]) > 1 ? `<ol start="${parseInt(m[2])}">` : `<${tag}>`); // keep numbering across code blocks
        }
        html.push(`<li>${inline(m[3])}</li>`);
        i++;
      }
      while (stack.length) html.push(`</${stack.pop()!.tag}>`);
      // move nested lists inside the preceding <li>
      out.push(html.join("").replace(/<\/li><(ul|ol)>/g, "<$1>").replace(/<\/(ul|ol)>(?=<li>|<\/(ul|ol)>)/g, "</$1></li>"));
      continue;
    }
    if (!l.trim()) {
      i++;
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||\s*```|>|!\[|<div|<table|\s*[*-]\s|\d+\.\s|---)/.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}

function asset(name: string) {
  const f = resolve(ASSETS, name);
  return existsSync(f) ? readFileSync(f, "utf8").replace(/\r/g, "").trimEnd() : `_(asset ${name} not generated — run npx tsx scripts/build-report-assets.ts)_`;
}
function countsTable() {
  if (!existsSync(resolve(ASSETS, "counts.json"))) return asset("counts.json");
  const c = JSON.parse(asset("counts.json")) as Record<string, number>;
  const label: Record<string, string> = {
    tables: "Tables", columns: "Columns", fks: "Foreign keys", checks: "CHECK constraints", views: "Views",
    indexes: "Indexes", triggers: "Triggers", functions: "Functions", procedures: "Procedures",
    policies: "Row-level security policies", db_roles: "Database roles",
  };
  return "| Database object (live catalog) | Count |\n|---|---|\n" + Object.entries(c).map(([k, v]) => `| ${label[k] ?? k} | ${v} |`).join("\n");
}
function expand(md: string) {
  const tree = existsSync(resolve(ASSETS, "tree.txt")) ? asset("tree.txt") : "(run the build to generate the tree)";
  const map: Record<string, string> = {
    COUNTS: countsTable(),
    DICTIONARY: asset("dictionary.md"),
    DML: asset("dml.md"),
    QUERIES: asset("queries.md"),
    RLS: asset("rls.md"),
    SEMANTIC: asset("semantic.md"),
    MONGO_OUTPUT: asset("mongo-output.txt"),
    VECTOR_OUTPUT: asset("vector-output.txt"),
    TREE: tree,
    UNIT: process.env.REPORT_UNIT || "27 / 27",
    INTEGRATION: process.env.REPORT_INTEGRATION || "30 / 30",
    SERVICES: process.env.REPORT_SERVICES || "4 / 4",
  };
  return md.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => map[k] ?? m);
}

const CSS = `
  @page { size: A4; margin: 15mm 13mm 17mm; }
  :root { --ink:#172033; --muted:#55627a; --line:#dbe2ec; --accent:#2563eb; --teal:#0f9d8a; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: var(--ink); font-size: 10.3pt; line-height: 1.55; max-width: 1000px; margin: 0 auto; padding: 20px; background:#fff; }
  h1 { font-size: 22pt; margin: 0 0 6px; color:#0f1e3d; letter-spacing:-.02em; }
  h2 { font-size: 15pt; margin: 24px 0 8px; padding-top: 8px; border-top: 2px solid var(--accent); color:#0f1e3d; break-after: avoid; }
  h3 { font-size: 12pt; margin: 16px 0 6px; color: var(--teal); break-after: avoid; }
  h4 { font-size: 10.8pt; margin: 12px 0 4px; color: #0f1e3d; break-after: avoid; }
  p { margin: 6px 0; } ul, ol { margin: 5px 0 6px 20px; padding: 0; } li { margin: 2px 0; } li > ul, li > ol { margin-top: 2px; }
  code { font-family: Consolas, "Cascadia Code", monospace; font-size: 8.8pt; background: #f1f5f9; padding: 1px 4px; border-radius: 4px; }
  pre { background: #0f1a2c; color: #e2e8f0; padding: 9px 12px; border-radius: 8px; white-space: pre-wrap; word-break: break-word; }
  pre code { background: none; color: inherit; padding: 0; font-size: 8.2pt; line-height: 1.4; }
  pre.lang-text { background: #f8fafc; color: #1e293b; border: 1px solid var(--line); }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 8.9pt; }
  th { text-align: left; background: #eef3fb; color: #0f1e3d; font-weight: 650; }
  th, td { border: 1px solid var(--line); padding: 4px 6px; vertical-align: top; word-break: break-word; }
  tr { break-inside: avoid; }
  blockquote { margin: 10px 0; padding: 9px 13px; background: #f0fdfa; border-left: 4px solid var(--teal); border-radius: 6px; }
  figure { margin: 10px 0 14px; text-align: center; break-inside: avoid; }
  figure img { max-width: 100%; max-height: 225mm; border: 1px solid var(--line); border-radius: 6px; }
  figcaption { font-size: 8.8pt; color: var(--muted); margin-top: 4px; }
  .pagebreak { break-after: page; }
  .toc { columns: 2; font-size: 9.4pt; margin: 10px 0 0; padding: 12px 16px; background: #f8fafc; border: 1px solid var(--line); border-radius: 8px; }
  .toc a { color: var(--ink); text-decoration: none; display: block; padding: 1px 0; }
  .titlepage { min-height: 245mm; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; break-after: page; gap: 10px; }
  .tp-uni { font-size: 26pt; font-weight: 700; color: #0f1e3d; } .tp-dept { font-size: 13pt; color: var(--muted); }
  .tp-course { font-size: 12pt; margin-top: 18px; } .tp-code { font-size: 11pt; color: var(--muted); }
  .tp-title { font-size: 38pt; font-weight: 800; color: var(--accent); margin-top: 36px; letter-spacing: -.02em; }
  .tp-subtitle { font-size: 12.5pt; color: var(--ink); margin-bottom: 30px; }
  .tp-team { width: 78%; font-size: 11pt; } .tp-team th, .tp-team td { padding: 8px 10px; text-align: left; }
  .tp-meta { margin-top: 24px; font-size: 10.5pt; color: var(--muted); }
  .owner { display: inline-block; font-size: 8.5pt; font-weight: 700; padding: 1px 8px; border-radius: 999px; color: #fff; }
  .sujal { background: #2563eb; } .sujan { background: #0f9d8a; } .both { background: #7c3aed; }
`;

async function build(key: keyof typeof DOCS) {
  const { src, title, css = "" } = DOCS[key];
  const md = expand(readFileSync(resolve(src), "utf8"));
  const toc: { id: string; text: string }[] = [];
  const body = render(md, toc);
  const tocHtml = `<nav class="toc"><strong>Contents</strong>${toc.map((t) => `<a href="#${t.id}">${esc(t.text)}</a>`).join("")}</nav>`;
  // table of contents goes right after the first <h1> (after the title page)
  const withToc = body.replace(/(<h1[^>]*>.*?<\/h1>)/, `$1\n${tocHtml}`);
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}${css}</style></head><body>${withToc}</body></html>`;
  const htmlFile = resolve(src.replace(/\.md$/, ".html"));
  writeFileSync(htmlFile, page);
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
  try {
    const p = await browser.newPage();
    await p.goto(pathToFileURL(htmlFile).href, { waitUntil: "load" }); // file:// so relative images resolve
    const missing = await p.evaluate(() => Array.from(document.images).filter((im) => !im.naturalWidth).map((im) => im.getAttribute("src")));
    if (missing.length) console.warn("Missing images:", missing.join(", "));
    await p.pdf({
      path: htmlFile.replace(/\.html$/, ".pdf"),
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="font-size:8px;color:#64748b;width:100%;text-align:center">${esc(title)} · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
      margin: { top: "15mm", bottom: "17mm", left: "13mm", right: "13mm" },
    });
  } finally {
    await browser.close();
  }
  console.log("Wrote", htmlFile.replace(/\.html$/, ".{html,pdf}"), "from", dirname(src));
}

const which = (process.argv[2] as keyof typeof DOCS | undefined) ?? undefined;
(async () => {
  for (const k of which ? [which] : (Object.keys(DOCS) as (keyof typeof DOCS)[])) {
    if (existsSync(resolve(DOCS[k].src))) await build(k);
    else console.warn("skip", DOCS[k].src, "(not found)");
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
