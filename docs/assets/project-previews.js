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

for (const preview of document.querySelectorAll("[data-project-preview]")) {
  const project = projectPreviews.get(preview.dataset.projectPreview);
  if (!project) {
    continue;
  }

  const link = preview.querySelector(".project-preview-link");
  const title = link.querySelector(".tile-title").textContent;
  const description = document.createElement("span");
  description.className = "tile-description";
  description.textContent = project.description;
  link.append(description);

  const details = document.createElement("details");
  details.className = "project-preview-details";
  const summary = document.createElement("summary");
  summary.textContent = "More details";
  summary.setAttribute("aria-label", `More details about ${title}`);
  const copy = document.createElement("p");
  copy.textContent = project.details;
  details.append(summary, copy);
  preview.append(details);
}
