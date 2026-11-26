import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const siteRoot = new URL("../", import.meta.url);
const sharedDirectory = /^(assets|navbar)\//;
const pageAssets = /(^[ \t]*<(?:link|script)\b[^<>]*?\s(?:href|src)=)(["'])([^"']+)\2/gm;
const stylesheetAssets = /(\burl\(\s*)(["']?)([^'"\s)]+)\2(?=\s*\))/g;
const moduleImports = /(^[ \t]*import\s+(?:[^'";]*?\s+from\s+)?)(["'])(\.{1,2}\/[^"']+)\2/gm;

export function createAssetVersions() {
  const versions = new Map();
  const updatedSources = new Map();

  function versionReferences(source, file, pattern) {
    const base = new URL(file, siteRoot);
    return source.replace(pattern, (attribute, prefix, quote, reference) => {
      const [relativePath] = reference.split(/[?#]/, 1);
      if (!relativePath) return attribute;

      const url = new URL(reference, base);
      if (!url.href.startsWith(siteRoot.href)) return attribute;

      const asset = url.pathname.slice(siteRoot.pathname.length);
      if (!sharedDirectory.test(asset)) return attribute;

      url.searchParams.set("v", assetVersion(asset));
      return `${prefix}${quote}${relativePath}${url.search}${url.hash}${quote}`;
    });
  }

  function assetVersion(file) {
    if (versions.has(file)) {
      const version = versions.get(file);
      if (!version) throw new Error(`Circular shared asset reference to ${file}`);
      return version;
    }

    versions.set(file, null);
    let contents = readFileSync(new URL(file, siteRoot));
    const pattern = file.endsWith(".css") ? stylesheetAssets : file.endsWith(".js") ? moduleImports : null;
    if (pattern) {
      const source = contents.toString("utf8");
      contents = versionReferences(source, file, pattern);
      if (contents !== source) updatedSources.set(file, contents);
    }

    const version = createHash("sha256").update(contents).digest("hex").slice(0, 16);
    versions.set(file, version);
    return version;
  }

  return {
    updatedSources,
    versionPage(html, file) {
      return versionReferences(html, file, pageAssets);
    },
  };
}
