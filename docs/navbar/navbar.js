const navigation = document.querySelector(".site-nav");
const siteRoot = new URL("../", document.currentScript.src);
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
          <div class="nav-panel-content">
            <p class="nav-panel-title" aria-hidden="true">${name}</p>
            <ul class="nav-panel-links">
              ${projects.map(([path, title]) => `<li><a href="${slug}/${path}/">${title}</a></li>`).join("")}
              <li><a href="${slug}/filler/" aria-label="Filler for ${name}">Filler</a></li>
            </ul>
          </div>
        </div>
      </li>`).join("");

navigation.insertAdjacentHTML("beforeend", `
    <div class="nav-menu">
      <button class="menu-toggle" type="button" aria-controls="nav-links" aria-expanded="false" hidden>
        Menu <span class="chevron" aria-hidden="true"></span>
      </button>
      <ul class="nav-links" id="nav-links">${sectionLinks}
      </ul>
    </div>`);

const currentPath = window.location.pathname.replace(/\/index\.html$/, "/");
for (const link of navigation.querySelectorAll(".category-link, .nav-panel a")) {
  const destination = new URL(link.getAttribute("href"), siteRoot);
  link.href = destination.href;
  if (destination.pathname === currentPath) link.setAttribute("aria-current", "page");
}

const menu = navigation.querySelector(".menu-toggle");
const menuGroup = navigation.querySelector(".nav-menu");
const compactLayout = window.matchMedia("(width < 35rem), (hover: none)");
const categories = Array.from(navigation.querySelectorAll(".nav-item"), (item) => ({
  item,
  link: item.querySelector(".category-link"),
  panel: item.querySelector(".nav-panel"),
}));
let menuOpenedOnHover = false;
let openCategory = null;

function setExpanded(control, expanded) {
  control.setAttribute("aria-expanded", String(expanded));
}

function closePanel() {
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

menuGroup.addEventListener("pointerleave", () => {
  if (menuOpenedOnHover && !menuGroup.contains(document.activeElement)) closeMenu();
});

for (const category of categories) {
  const { item, link, panel } = category;

  link.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "touch" || compactLayout.matches || openCategory?.panel.contains(document.activeElement)) return;

    showPanel(category);
  });

  item.addEventListener("pointerleave", () => {
    if (openCategory === category && !item.querySelector(":focus-visible")) {
      closePanel();
    }
  });

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

if (navigation.hasAttribute("data-in-flow")) {
  const compactPanel = menuGroup.querySelector(".nav-links");
  const reservePanelSpace = new ResizeObserver(() => {
    const visiblePanel = compactLayout.matches ? compactPanel : openCategory?.panel;
    const height = visiblePanel?.getBoundingClientRect().height ?? 0;
    navigation.style.setProperty("--nav-panel-height", `${height}px`);
  });
  reservePanelSpace.observe(compactPanel, { box: "border-box" });
  for (const { panel } of categories) {
    reservePanelSpace.observe(panel, { box: "border-box" });
  }
}
