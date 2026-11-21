# README maintenance

- Keep the live site link first, followed by a short explanation of what the site is for. Link each section heading and project subheading to its live page.
- Use simple ninth-grade English and vary the sentence structure. Give each project two or three short sentences about what it does, what makes it different, and how to use its features.
- Update the README whenever a project is added or an existing project gets a major new feature.

## Site navigation

- Add `<header data-site-navbar></header>` at the top of every new page. Load the shared `docs/navbar/navbar.css` and `docs/navbar/navbar.js` using paths relative to the page and copy their current version parameters from an existing page.
- Add each new project or section page to the appropriate section in `docs/navbar/navbar.js` so it appears in the desktop panels and phone menu.
- Keep the navbar markup, sizing, and behavior in `docs/navbar`. The shared navbar stays visible on scroll and reserves space for expanded panels. Check the links and layout with mouse, keyboard, and touch, and fix any overlap or blocked controls.
