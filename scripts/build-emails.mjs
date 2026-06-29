// Compile MJML email templates → a generated TS module the Pages Function imports.
//
// MJML can't run in the Cloudflare Workers runtime, so we render to static HTML at
// build time (with {{placeholders}} kept intact) and substitute values at send time.
// Wired into `astro build` (astro.config.mjs) so it stays in sync; also runnable
// directly via `bun run build:emails`.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(root, "emails");
const outFile = join(root, "functions", "api", "_emails.generated.ts");

export async function buildEmails() {
  if (!existsSync(srcDir)) return [];
  // Dynamic import keeps mjml out of `astro dev` startup (only loaded at build).
  const { default: mjml2html } = await import("mjml");

  const files = readdirSync(srcDir)
    .filter((f) => f.endsWith(".mjml"))
    .sort();

  const lines = [];
  for (const file of files) {
    const constName =
      basename(file, ".mjml").replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()) + "EmailHtml";
    const { html, errors } = await mjml2html(readFileSync(join(srcDir, file), "utf8"), {
      validationLevel: "strict",
      filePath: join(srcDir, file),
    });
    if (errors?.length) {
      for (const e of errors) console.error(`MJML ${file}:`, e.formattedMessage ?? e.message ?? e);
      throw new Error(`MJML compile failed for ${file}`);
    }
    lines.push(`export const ${constName} = ${JSON.stringify(html)};`);
  }

  const banner =
    "// GENERATED FILE — do not edit by hand.\n" +
    "// Source: emails/*.mjml — regenerate with `bun run build:emails` (also runs on `astro build`).\n\n";
  writeFileSync(outFile, banner + lines.join("\n") + "\n");
  return files;
}

// `node scripts/build-emails.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  const files = await buildEmails();
  console.log(`Compiled ${files.length} email template(s) → functions/api/_emails.generated.ts`);
}
