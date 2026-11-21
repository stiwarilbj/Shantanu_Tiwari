const navbarContainer = document.querySelector("[data-site-navbar]");
navbarContainer.style.setProperty("--nav-height", "clamp(2.625rem, calc(1.875rem + 1.75vw), 3.125rem)");
navbarContainer.style.minBlockSize = "var(--nav-height)";

const navbarUrl = new URL(import.meta.url);
const siteRoot = new URL("../", navbarUrl);

await Promise.all(["navbar.css", "dropdown.css"].map((filename) => {
  const stylesheetUrl = new URL(filename, navbarUrl);
  stylesheetUrl.search = navbarUrl.search;

  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = stylesheetUrl.href;
  return new Promise((resolve) => {
    stylesheet.addEventListener("load", resolve, { once: true });
    stylesheet.addEventListener("error", resolve, { once: true });
    document.head.append(stylesheet);
  });
}));

const sections = [
  ["experiments", "Experiments"],
  ["learning", "Learning", [["places-game", "Place Naming Game"]]],
  ["games", "Games"],
  ["old-projects", "Old Projects"],
];

const sectionLinks = sections.map(([slug, name, projects = []]) => `
      <li class="nav-item">
        <a class="category-link" href="${slug}/" aria-controls="${slug}-panel">
          <span class="category-label">${name} <span class="chevron" aria-hidden="true"></span></span>
        </a>
        <div class="nav-panel" id="${slug}-panel" hidden>
          <ul class="nav-panel-links">
            ${projects.map(([path, title]) => `<li><a href="${slug}/${path}/">${title}</a></li>`).join("")}
            <li><a href="${slug}/filler/" aria-label="Filler for ${name}">Filler</a></li>
          </ul>
        </div>
      </li>`).join("");

navbarContainer.innerHTML = `
  <nav class="site-nav" aria-label="Main navigation">
    <a class="wordmark" href="./">Project Lab</a>
    <div class="nav-menu">
      <button class="menu-toggle" type="button" aria-controls="nav-links" aria-expanded="false" hidden>
        Menu <span class="chevron" aria-hidden="true"></span>
      </button>
      <ul class="nav-links" id="nav-links">${sectionLinks}
      </ul>
    </div>
  </nav>`;

const navigation = navbarContainer.querySelector(".site-nav");
const currentPath = window.location.pathname.replace(/\/index\.html$/, "/");
for (const link of navigation.querySelectorAll("a[href]")) {
  const destination = new URL(link.getAttribute("href"), siteRoot);
  link.href = destination.href;
  if (destination.pathname === currentPath) link.setAttribute("aria-current", "page");
}

const menu = navigation.querySelector(".menu-toggle");
const menuGroup = navigation.querySelector(".nav-menu");
const compactPanel = menuGroup.querySelector(".nav-links");
const compactLayout = window.matchMedia("(width < 35rem), (hover: none)");
const categories = Array.from(navigation.querySelectorAll(".nav-item"), (item) => ({
  item,
  link: item.querySelector(".category-link"),
  panel: item.querySelector(".nav-panel"),
}));
let menuOpenedOnHover = false;
let openCategory = null;
let panelCloseTimer;
let panelSwitchTimer;

function setExpanded(control, expanded) {
  control.setAttribute("aria-expanded", String(expanded));
}

function cancelPanelSwitch() {
  clearTimeout(panelSwitchTimer);
  panelSwitchTimer = undefined;
}

function closePanel() {
  clearTimeout(panelCloseTimer);
  cancelPanelSwitch();
  if (!openCategory) return;

  setExpanded(openCategory.link, false);
  openCategory.panel.hidden = true;
  openCategory = null;
}

function showPanel(category) {
  if (openCategory === category) return;

  closePanel();
  openCategory = category;
  setExpanded(category.link, true);
  category.panel.hidden = false;
}

function closeMenu() {
  closePanel();
  setExpanded(menu, false);
  menuOpenedOnHover = false;
}

function syncLayout() {
  closeMenu();
  for (const { link, panel } of categories) {
    panel.hidden = !compactLayout.matches;
    if (compactLayout.matches) {
      link.removeAttribute("aria-expanded");
    } else {
      setExpanded(link, false);
    }
  }
}

menu.addEventListener("click", (event) => {
  if (menuOpenedOnHover && event.detail > 0) {
    menuOpenedOnHover = false;
  } else if (menu.getAttribute("aria-expanded") === "true") {
    closeMenu();
  } else {
    setExpanded(menu, true);
  }
});

menu.addEventListener("pointerenter", (event) => {
  if (event.pointerType === "touch" || menu.getAttribute("aria-expanded") === "true") return;

  menuOpenedOnHover = true;
  setExpanded(menu, true);
});

menuGroup.addEventListener("pointerenter", () => clearTimeout(panelCloseTimer));

menuGroup.addEventListener("pointerleave", () => {
  if (menuOpenedOnHover && !menuGroup.contains(document.activeElement)) closeMenu();
  if (openCategory && !openCategory.item.querySelector(":focus-visible")) {
    panelCloseTimer = setTimeout(() => {
      if (!openCategory?.item.querySelector(":focus-visible")) closePanel();
    }, 150);
  }
});

for (const category of categories) {
  const { link, panel } = category;

  // A gap disappearing under a stationary pointer shouldn't reopen a panel.
  link.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch" || compactLayout.matches || openCategory?.panel.contains(document.activeElement)) return;

    if (!openCategory) {
      showPanel(category);
    } else if (openCategory !== category && panelSwitchTimer === undefined) {
      // Give the pointer time to cross another button on the way to the open panel.
      panelSwitchTimer = setTimeout(() => {
        panelSwitchTimer = undefined;
        if (link.matches(":hover") && !openCategory?.panel.contains(document.activeElement)) showPanel(category);
      }, 120);
    }
  });

  link.addEventListener("pointerleave", cancelPanelSwitch);

  link.addEventListener("focus", () => {
    if (!compactLayout.matches && link.matches(":focus-visible")) showPanel(category);
  });

  link.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" || compactLayout.matches) return;

    event.preventDefault();
    showPanel(category);
    panel.querySelector("a").focus();
  });
}

document.addEventListener("click", (event) => {
  if (!navigation.contains(event.target)) closeMenu();
});

document.addEventListener("focusin", (event) => {
  if (!navigation.contains(event.target)) {
    closeMenu();
  } else if (openCategory && !openCategory.item.contains(event.target)) {
    closePanel();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  if (openCategory) {
    if (openCategory.panel.contains(document.activeElement)) openCategory.link.focus();
    closePanel();
    event.preventDefault();
  } else if (menu.getAttribute("aria-expanded") === "true") {
    closeMenu();
    menu.focus();
    event.preventDefault();
  }
});

compactLayout.addEventListener("change", syncLayout);

syncLayout();
menu.hidden = false;
navigation.dataset.ready = "";

const reservePanelSpace = new ResizeObserver(() => {
  const height = compactPanel.getBoundingClientRect().height;
  navbarContainer.style.setProperty("--nav-panel-height", `${height}px`);
});
reservePanelSpace.observe(compactPanel, { box: "border-box" });
