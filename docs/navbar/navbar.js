import { setupNavbarSearch } from "./search.js?v=4f7b0067ba6eff48";

const navbarContainer = document.querySelector("[data-site-navbar]");
const navigation = navbarContainer.querySelector(".site-nav");
const searchablePages = Array.from(navigation.querySelectorAll("[data-nav-search]"), (link) => ({
  name: link.textContent.trim(),
  url: link.href,
}));

const menu = navigation.querySelector(".menu-toggle");
const menuGroup = navigation.querySelector(".nav-menu");
const searchGroup = navigation.querySelector(".nav-search");
const closeSearch = setupNavbarSearch(searchGroup, searchablePages, closeMenu);
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

  closeSearch();
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
    closeSearch();
    setExpanded(menu, true);
  }
});

menu.addEventListener("pointerenter", (event) => {
  if (event.pointerType === "touch" || menu.getAttribute("aria-expanded") === "true") return;

  closeSearch();
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
      }, 50);
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
  if (!searchGroup.contains(event.target)) closeSearch();
  if (!navigation.contains(event.target)) closeMenu();
});

document.addEventListener("focusin", (event) => {
  if (!searchGroup.contains(event.target)) closeSearch();
  if (!navigation.contains(event.target)) {
    closeMenu();
  } else if (openCategory && !openCategory.item.contains(event.target)) {
    closePanel();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.isComposing) return;

  if (closeSearch()) {
    event.preventDefault();
  } else if (openCategory) {
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

const reservePanelSpace = new ResizeObserver(() => {
  const height = compactPanel.getBoundingClientRect().height;
  navbarContainer.style.setProperty("--nav-panel-height", `${height}px`);
});
reservePanelSpace.observe(compactPanel, { box: "border-box" });
