# README maintenance

- Keep the live site link first, followed by a short explanation of what the site is for. Link each section heading and project subheading to its live page.
- Use simple ninth-grade English and vary the sentence structure. Give each project two or three short sentences about what it does, what makes it different, and how to use its features.
- Update the README whenever a project is added or an existing project gets a major new feature.

## Site navigation

- Add `<header data-site-navbar></header>` at the top of each new page under `docs`. Run `node docs/navbar/generate.mjs` from the repository root to fill the header and link its assets. Commit the generated pages. Use `node docs/navbar/generate.mjs --check` to verify they are up to date. The Evolution Simulator's Project Lab build uses the same renderer.
- Add each new project or section to the list in `docs/navbar/render.mjs` and regenerate the pages so it appears in the desktop panels, phone menu, and navbar search. Update `navbarVersion` there when changing the shared navbar CSS or script.
- Keep the navbar markup, sizing, and behavior in `docs/navbar`. The shared navbar stays visible on scroll. Desktop hover panels sit under the section buttons, and the phone menu reserves space when expanded. Check the links and layout with mouse, keyboard, and touch, and fix any overlap or blocked controls.
- Give each new project a `.project-preview` card on its section page. Keep its one-sentence description and two to four sentences of details in `docs/assets/project-previews.js`, and use the same `data-project-preview` key when featuring it in Project Showcase.
