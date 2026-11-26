import { readFileSync } from "node:fs";
import { createAssetVersions } from "../assets/versions.mjs";

export const sections = [
  ["experiments", "Experiments", [["evolution-simulator", "Evolution Simulator"]]],
  ["learning", "Learning", [["places-game", "Place Naming Game"]]],
  ["games", "Games"],
  ["old-projects", "Old Projects"],
];

const navbarHeader = /^([ \t]*)<header data-site-navbar>[\s\S]*?<\/header>/m;
const navbarAssets = /^[ \t]*<!-- Shared navbar assets -->\r?\n[\s\S]*?^[ \t]*<!-- End shared navbar assets -->\r?\n/m;
const endOfHead = /^([ \t]*)<\/head>/m;
const navbarScript = readFileSync(new URL("./navbar.js", import.meta.url), "utf8").trimEnd();

export function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function renderNavbar(html, pageFile, versions = createAssetVersions()) {
  if (!navbarHeader.test(html) || !endOfHead.test(html)) {
    throw new Error(`Add a head and a <header data-site-navbar></header> to ${pageFile}`);
  }

  const root = "../".repeat(pageFile.split("/").length - 1) || "./";
  const pagePath = pageFile.replace(/(^|\/)index\.html$/, "$1");
  const isSectionLanding = sections.some(([slug]) => pagePath === `${slug}/`);
  const href = (path) => `href="${escapeHtml(root + path)}"${path === pagePath ? ' aria-current="page"' : ""}`;

  const sectionLinks = sections.map(([slug, name, projects = []]) => {
    const projectLinks = projects.map(([path, title]) => `
              <li><a ${href(`${slug}/${path}/`)} data-nav-search>${escapeHtml(title)}</a></li>`).join("");
    return `
        <li class="nav-item">
          <a class="category-link" ${href(`${slug}/`)} aria-controls="${slug}-panel" aria-expanded="false" data-nav-search>
            <span class="category-label">${escapeHtml(name)} <span class="chevron" aria-hidden="true"></span></span>
          </a>
          <div class="nav-panel" id="${slug}-panel" hidden>
            <ul class="nav-panel-links">${projectLinks}
              <li><a ${href(`${slug}/filler/`)} aria-label="Filler for ${escapeHtml(name)}">Filler</a></li>
            </ul>
          </div>
        </li>`;
  }).join("");

  const markup = `<header data-site-navbar>
  <script>
${navbarScript}
  </script>
  <nav class="site-nav" aria-label="Main navigation">
    <a class="wordmark" ${href("")}>Project Lab</a>
    <div class="nav-search" role="search" aria-label="Project Lab">
      <span class="nav-search-field">
        <input type="search" role="combobox" aria-label="Search projects and sections"
          aria-autocomplete="list" aria-expanded="false" aria-controls="nav-search-options"
          placeholder="Search" autocomplete="off" spellcheck="false">
      </span>
      <div class="nav-search-results" hidden>
        <ul id="nav-search-options" role="listbox" aria-label="Search results"></ul>
        <p class="nav-search-empty" role="status">No matching pages</p>
      </div>
    </div>
    <div class="nav-menu">
      <button class="menu-toggle" type="button" aria-controls="nav-links" aria-expanded="false">
        Menu <span class="chevron" aria-hidden="true"></span>
      </button>
      <ul class="nav-links" id="nav-links">${sectionLinks}
      </ul>
    </div>
  </nav>
  <script>document.currentScript.parentElement.dispatchEvent(new Event("navbar-parsed"));</script>
</header>`;

  const assets = [
    "<!-- Shared navbar assets -->",
    ...["navbar", "dropdown", "search"].map((name) =>
      `<link rel="stylesheet" href="${root}navbar/${name}.css">`),
    `<link id="navbar-search-module" rel="modulepreload" href="${root}navbar/search.js">`,
    ...(isSectionLanding ? [
      `<link rel="preload" as="font" type="font/woff2" crossorigin fetchpriority="low" href="${root}assets/inter-latin.woff2">`,
    ] : []),
    "<!-- End shared navbar assets -->",
  ];

  const rendered = html
    .replace(navbarHeader, (_, indent) => markup.split("\n").map((line) => line && indent + line).join("\n"))
    .replace(navbarAssets, "")
    .replace(endOfHead, (tag, indent) => [
      ...assets.map((line) => `${indent}  ${line}`),
      tag,
    ].join("\n"));

  return versions.versionPage(rendered, pageFile);
}
