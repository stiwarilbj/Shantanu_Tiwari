import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { renderNavbar } from "./render.mjs";

const pages = fileURLToPath(new URL("../", import.meta.url));
const check = process.argv.includes("--check");
const files = readdirSync(pages, { recursive: true }).filter((file) => file.endsWith(".html")).sort();

for (const file of files) {
  const path = join(pages, file);
  const original = readFileSync(path, "utf8");
  const rendered = renderNavbar(original, file.split(sep).join("/"));
  if (original === rendered) continue;

  if (check) {
    console.error(`Regenerate the navbar in docs/${file}`);
    process.exitCode = 1;
  } else {
    writeFileSync(path, rendered);
  }
}
