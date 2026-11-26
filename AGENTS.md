# README maintenance

- Keep the live site link first, followed by a short explanation of what the site is for. Link each section heading and project subheading to its live page.
- Use simple ninth-grade English and vary the sentence structure. Give each project two or three short sentences about what it does, what makes it different, and how to use its features.
- Update the README whenever a project is added or an existing project gets a major new feature.

## Site navigation

- Add `<header data-site-navbar></header>` at the top of each new page under `docs`. After adding a page or changing a shared asset or project preview, run `node docs/navbar/generate.mjs` from the repository root. It fills the headers and project cards and gives shared files content-based URLs. Commit the refreshed files and use `node docs/navbar/generate.mjs --check` to verify them. The Evolution Simulator's Project Lab build runs the same generator.
- Add each new project or section to the list in `docs/navbar/render.mjs` and regenerate the pages so it appears in the desktop panels, phone menu, and navbar search.
- Keep the navbar markup, sizing, and behavior in `docs/navbar`. The shared navbar stays visible on scroll. Desktop hover panels sit under the section buttons, and the phone menu reserves space when expanded. Check the links and layout with mouse, keyboard, and touch, and fix any overlap or blocked controls.
- Give each new project a card on its section page with `<article class="tile project-tile project-preview" data-project-preview="project-slug"></article>`. Use the same key when featuring it in Project Showcase. Keep its one-sentence description and two to four sentences of details in `docs/assets/project-previews.mjs`. The generator gets each title and link from the section list in `docs/navbar/render.mjs`.
