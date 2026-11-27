import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderProjectPreviews } from "../assets/project-previews.mjs";
import { createAssetVersions } from "../assets/versions.mjs";
import { renderNavbar } from "./render.mjs";

const pages = fileURLToPath(new URL("../", import.meta.url));
const check = process.argv.includes("--check");
const versions = createAssetVersions();
const updatedPages = new Map();
const simulatorSource = "experiments/evolution-simulator/source";

function* publishedPages(directory = "") {
  for (const entry of readdirSync(join(pages, directory), { withFileTypes: true })) {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory() && path !== simulatorSource) {
      yield* publishedPages(path);
    } else if (entry.isFile() && path.endsWith(".html")) {
      yield path;
    }
  }
}

for (const page of [...publishedPages()].sort()) {
  const original = readFileSync(join(pages, page), "utf8");
  const rendered = renderNavbar(renderProjectPreviews(original, page), page, versions);
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
