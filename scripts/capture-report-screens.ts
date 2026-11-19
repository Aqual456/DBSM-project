// Captures application and code screenshots for docs/report.
// Usage: REPORT_BASE=http://localhost:3100 REPORT_EMAIL=admin@reliefflow.local REPORT_PASSWORD=... npx tsx scripts/capture-report-screens.ts
// The password is read from the environment only and never written anywhere.
import { chromium, type Page } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const base = process.env.REPORT_BASE || "http://localhost:3000";
const email = process.env.REPORT_EMAIL || "admin@reliefflow.local";
const password = process.env.REPORT_PASSWORD;
const out = "docs/report/assets/shots";
mkdirSync(out, { recursive: true });

async function tryDo(label: string, fn: () => Promise<unknown>) {
  try { await fn(); } catch (e) { console.warn(`  (${label} skipped: ${(e as Error).message.split("\n")[0]})`); }
}
async function shot(page: Page, name: string, full = false) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, name), fullPage: full });
  console.log("saved", name);
}
async function visit(page: Page, route: string) {
  await page.goto(base + route);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.locator("h1").first().waitFor();
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const KW = /\b(CREATE|OR|REPLACE|FUNCTION|RETURNS|TRIGGER|AS|BEGIN|END|IF|THEN|ELSE|ELSIF|RAISE|EXCEPTION|SELECT|FROM|WHERE|AND|NOT|NULL|INSERT|INTO|UPDATE|SET|DELETE|POLICY|ON|FOR|TO|USING|WITH|CHECK|ALTER|TABLE|ENABLE|ROW|LEVEL|SECURITY|PROCEDURE|LANGUAGE|DECLARE|LOOP|RETURN|NEW|OLD|PERFORM|CALL|export|async|function|await|const|let|return|if|try|catch|finally|throw|import|from|type|new)\b/g;
function highlight(code: string) {
  return code.split("\n").map((line) => {
    const cm = line.match(/^(.*?)(--.*|\/\/.*)$/);
    const body = cm ? cm[1] : line;
    const comment = cm ? `<span class="c">${esc(cm[2])}</span>` : "";
    const parts = body.split(/('(?:[^']|'')*'|"[^"]*"|`[^`]*`)/g);
    return parts.map((p, i) => (i % 2 ? `<span class="s">${esc(p)}</span>` : esc(p).replace(KW, '<span class="k">$1</span>'))).join("") + comment;
  }).join("\n");
}
function snippet(file: string, start: RegExp, lines: number) {
  const all = readFileSync(file, "utf8").split(/\r?\n/);
  const i = all.findIndex((l) => start.test(l));
  if (i < 0) throw new Error(`pattern not found in ${file}: ${start}`);
  return { from: i + 1, code: all.slice(i, i + lines).join("\n") };
}
const codeShots: { name: string; file: string; start: RegExp; lines: number }[] = [
  { name: "code-01-transaction.png", file: "src/lib/api.ts", start: /^export const dbRole/, lines: 34 },
  { name: "code-02-rls.png", file: "db/postgres/008_rbac_dictionary.sql", start: /ENABLE ROW LEVEL SECURITY/, lines: 26 },
  { name: "code-03-trigger.png", file: "db/postgres/005_integrity_security.sql", start: /CREATE OR REPLACE FUNCTION validate_allocation_item/, lines: 34 },
  { name: "code-04-procedure.png", file: "db/postgres/007_dbms_engineering.sql", start: /CREATE OR REPLACE PROCEDURE refresh_request_status/, lines: 32 },
  { name: "code-05-mongo.png", file: "src/app/api/incidents/route.ts", start: /^export const POST/, lines: 34 },
  { name: "code-06-embeddings.png", file: "src/lib/embeddings.ts", start: /async function localExtractor|function localExtractor/, lines: 30 },
];

async function main() {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
  try {
    const code = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 2 });
    for (const c of codeShots) {
      await tryDo(c.name, async () => {
        const s = snippet(c.file, c.start, c.lines);
        const nums = s.code.split("\n").map((_, i) => s.from + i).join("\n");
        await code.setContent(`<!doctype html><html><head><style>
          body{margin:0;background:#0f172a;font:13px/1.55 Consolas,"Cascadia Code",monospace;color:#e2e8f0}
          .bar{background:#1e293b;padding:8px 14px;color:#94a3b8;font:12px system-ui;border-bottom:1px solid #334155}
          .bar b{color:#e2e8f0}.wrap{display:flex;padding:12px 0}
          pre{margin:0;padding:0 16px;white-space:pre}.n{color:#475569;text-align:right;user-select:none}
          .k{color:#c084fc}.s{color:#86efac}.c{color:#64748b;font-style:italic}</style></head>
          <body><div class="bar"><b>${esc(c.file)}</b> · lines ${s.from}–${s.from + c.lines - 1}</div>
          <div class="wrap"><pre class="n">${nums}</pre><pre>${highlight(s.code)}</pre></div></body></html>`);
        const el = code.locator("body");
        await el.screenshot({ path: path.join(out, c.name) });
        console.log("saved", c.name);
      });
    }
    if (!password) { console.log("REPORT_PASSWORD not set: application screenshots skipped"); return; }

    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(base + "/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(base + "/");
    await page.locator(".kpi-value").first().waitFor();
    await shot(page, "01-command-center.png");

    await visit(page, "/requests");
    await tryDo("request detail", async () => {
      await page.locator("tbody tr").first().click();
      await page.getByRole("dialog").waitFor({ timeout: 5000 });
    });
    await shot(page, "02-request-pipeline.png");
    await tryDo("allocation planner", async () => {
      await page.keyboard.press("Escape");
      // pick an approved request that still has outstanding demand
      const rows = page.locator("tbody tr").filter({ hasText: /approved|partial/i });
      await rows.first().click();
      await page.getByRole("button", { name: "Plan allocation" }).click({ timeout: 5000 });
      await page.waitForTimeout(1200);
    });
    await shot(page, "03-allocation-planner.png");
    await page.keyboard.press("Escape").catch(() => undefined);

    await visit(page, "/map");
    await page.waitForTimeout(2500);
    await shot(page, "04-map.png");

    await visit(page, "/incidents");
    await shot(page, "05-incidents.png");

    await visit(page, "/lab/vector");
    await tryDo("semantic search", async () => {
      const box = page.getByLabel("Search text");
      await box.fill("kids getting ill from dirty water");
      await box.press("Enter");
      await page.waitForTimeout(3500);
    });
    await shot(page, "06-vector-search.png");

    await visit(page, "/lab/security");
    await tryDo("rbac run", async () => {
      await page.getByRole("button", { name: "Run", exact: true }).first().click();
      await page.getByText(/DENIED|ALLOWED/).first().waitFor({ timeout: 8000 });
    });
    await shot(page, "07-rbac-lab.png");

    await visit(page, "/lab/er");
    await page.locator(".er-entity").first().waitFor().catch(() => undefined);
    await shot(page, "08-er-explorer.png");

    await visit(page, "/lab/transactions");
    await tryDo("concurrency run", async () => {
      await page.getByRole("button", { name: /^Run/ }).first().click();
      await page.waitForTimeout(6000);
    });
    await shot(page, "09-concurrency.png");

    await visit(page, "/lab/optimization");
    await tryDo("optimisation run", async () => {
      await page.getByRole("button", { name: /^Run/ }).first().click();
      await page.waitForTimeout(6000);
    });
    await shot(page, "10-optimisation.png");

    for (const [route, name] of [["/lab/nosql", "11-nosql-lab.png"], ["/intelligence", "12-intelligence.png"], ["/analytics", "13-analytics.png"], ["/lab/sql", "14-sql-lab.png"]] as const) {
      await tryDo(name, async () => { await visit(page, route); await shot(page, name); });
    }
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
