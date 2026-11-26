import { posix } from "node:path";
import { escapeHtml, sections } from "../navbar/render.mjs";

const projectPreviews = new Map([
  ["evolution-simulator", {
    description: "Watch a population of blobs evolve over generations",
    details: [
      "Set the food supply and decide how much traits like size, speed, and sight can change.",
      "Follow a blob through a day, skip ahead with Quick Sim, or replay a past generation.",
      "Use charts to track changes and compare runs side by side.",
    ].join(" "),
  }],
  ["places-game", {
    description: "Name as many places as you can before time runs out",
    details: [
      "Play worldwide or pick a country, then set the timer and choose starting and ending letters.",
      "Earn a point for each new place you name, even if you make a small typo.",
      "Get random examples or search for places by country, letters, name length, and words to include or skip.",
    ].join(" "),
  }],
]);

const projects = new Map(sections.flatMap(([section, , entries = []]) =>
  entries.map(([slug, title]) => [slug, { title, path: `${section}/${slug}` }])
));
const previewCard = /^([ \t]*)<article\b[^>]*\sdata-project-preview="([^"]+)"[^>]*>[\s\S]*?<\/article>/gm;

export function renderProjectPreviews(html, pageFile) {
  return html.replace(previewCard, (_, indent, slug) => {
    const project = projects.get(slug);
    const preview = projectPreviews.get(slug);
    if (!project || !preview) {
      throw new Error(`Missing project title, route, or description for "${slug}" in ${pageFile}`);
    }

    const title = escapeHtml(project.title);
    const href = escapeHtml(`${posix.relative(posix.dirname(pageFile), project.path)}/`);
    const card = `<article class="tile project-tile project-preview" data-project-preview="${escapeHtml(slug)}">
  <a class="project-preview-link" href="${href}">
    <span class="project-preview-heading">
      <span class="tile-title">${title}</span>
      <span class="tile-arrow" aria-hidden="true">→</span>
    </span>
    <span class="tile-description">${escapeHtml(preview.description)}</span>
  </a>
  <details class="project-preview-details">
    <summary aria-label="More details about ${title}">More details</summary>
    <p>${escapeHtml(preview.details)}</p>
  </details>
</article>`;

    return card.split("\n").map((line) => indent + line).join("\n");
  });
}
