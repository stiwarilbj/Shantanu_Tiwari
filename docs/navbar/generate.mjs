import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createAssetVersions } from "../assets/versions.mjs";
import { renderNavbar } from "./render.mjs";

const pages = fileURLToPath(new URL("../", import.meta.url));
const check = process.argv.includes("--check");
const files = readdirSync(pages, { recursive: true }).filter((file) => file.endsWith(".html")).sort();
const versions = createAssetVersions();
const updatedPages = new Map();

for (const file of files) {
  const page = file.split(sep).join("/");
  const original = readFileSync(join(pages, file), "utf8");
  const rendered = renderNavbar(original, page, versions);
  if (original !== rendered) updatedPages.set(page, rendered);
}

for (const [file, contents] of [...versions.updatedSources, ...updatedPages]) {
  if (check) {
    console.error(`Regenerate shared references in docs/${file}`);
    process.exitCode = 1;
  } else {
    writeFileSync(join(pages, file), contents);
  }
}
