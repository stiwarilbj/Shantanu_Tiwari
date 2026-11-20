const navigation = document.querySelector(".site-nav");
const siteRoot = new URL("../", document.currentScript.src);
const sections = [
  ["experiments", "Experiments"],
  ["learning", "Learning"],
  ["games", "Games"],
  ["old-projects", "Old Projects"],
];

const sectionLinks = sections.map(([slug, name]) => `
      <li class="nav-item">
        <a class="category-link" href="${slug}/" aria-controls="${slug}-filler">
          ${name} <span class="chevron" aria-hidden="true"></span>
        </a>
        <a class="filler-link" id="${slug}-filler" href="${slug}/filler/" aria-label="Filler for ${name}" hidden>Filler</a>
      </li>`).join("");

navigation.insertAdjacentHTML("beforeend", `
    <button class="menu-toggle" type="button" aria-controls="nav-links" aria-expanded="false" hidden>
      Menu <span class="chevron" aria-hidden="true"></span>
    </button>
    <ul class="nav-links" id="nav-links">${sectionLinks}
    </ul>`);

const currentPath = window.location.pathname.replace(/\/index\.html$/, "/");
for (const link of navigation.querySelectorAll(".category-link, .filler-link")) {
  const destination = new URL(link.getAttribute("href"), siteRoot);
  link.href = destination.href;
  if (destination.pathname === currentPath) link.setAttribute("aria-current", "page");
}

const menu = navigation.querySelector(".menu-toggle");
const compactLayout = window.matchMedia("(max-width: 1023px), (hover: none)");
const withoutHover = window.matchMedia("(hover: none)");
const categories = Array.from(navigation.querySelectorAll(".nav-item"), (item) => ({
  item,
  link: item.querySelector(".category-link"),
  filler: item.querySelector(".filler-link"),
}));
const hoverDelay = 120;
let hoverTimer;
let openCategory = null;

function setExpanded(control, expanded) {
  control.setAttribute("aria-expanded", String(expanded));
}

function cancelHover() {
  window.clearTimeout(hoverTimer);
}

function closeSubmenu() {
  cancelHover();
  if (!openCategory) return;

  setExpanded(openCategory.link, false);
  openCategory.filler.hidden = true;
  openCategory = null;
}

function showSubmenu(category) {
  if (openCategory === category) return;

  closeSubmenu();
  openCategory = category;
  setExpanded(category.link, true);
  category.filler.hidden = false;
}

function closeMenu() {
  closeSubmenu();
  setExpanded(menu, false);
}

function syncHoverMode() {
  closeMenu();
  for (const { link, filler } of categories) {
    filler.hidden = !withoutHover.matches;
    if (withoutHover.matches) {
      link.removeAttribute("aria-expanded");
    } else {
      setExpanded(link, false);
    }
  }
}

menu.addEventListener("click", () => {
  if (menu.getAttribute("aria-expanded") === "true") {
    closeMenu();
  } else {
    setExpanded(menu, true);
  }
});

for (const category of categories) {
  const { item, link, filler } = category;

  function waitForHover(event) {
    if (event.pointerType === "touch" || withoutHover.matches || openCategory === category) return;

    cancelHover();
    hoverTimer = window.setTimeout(() => {
      if (link.matches(":hover") && !openCategory?.filler.matches(":focus")) {
        showSubmenu(category);
      }
    }, hoverDelay);
  }

  link.addEventListener("pointerenter", waitForHover);
  link.addEventListener("pointermove", waitForHover);
  link.addEventListener("pointerleave", cancelHover);

  item.addEventListener("pointerleave", () => {
    if (openCategory === category && !item.querySelector(":focus-visible")) {
      closeSubmenu();
    }
  });

  link.addEventListener("focus", () => {
    if (!withoutHover.matches && link.matches(":focus-visible")) showSubmenu(category);
  });

  link.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" || withoutHover.matches) return;

    event.preventDefault();
    showSubmenu(category);
    filler.focus();
  });
}

document.addEventListener("click", (event) => {
  if (!navigation.contains(event.target)) closeMenu();
});

document.addEventListener("focusin", (event) => {
  if (!navigation.contains(event.target)) {
    closeMenu();
  } else if (openCategory && !openCategory.item.contains(event.target)) {
    closeSubmenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  cancelHover();
  if (openCategory) {
    if (document.activeElement === openCategory.filler) openCategory.link.focus();
    closeSubmenu();
    event.preventDefault();
  } else if (menu.getAttribute("aria-expanded") === "true") {
    closeMenu();
    menu.focus();
    event.preventDefault();
  }
});

compactLayout.addEventListener("change", closeMenu);
withoutHover.addEventListener("change", syncHoverMode);

syncHoverMode();
menu.hidden = false;
navigation.dataset.ready = "";
