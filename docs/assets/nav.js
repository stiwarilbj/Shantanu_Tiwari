const navigation = document.querySelector(".site-nav");
const menu = navigation.querySelector(".menu-toggle");
const desktop = window.matchMedia("(min-width: 1024px)");
let activeToggle = null;

function setExpanded(button, expanded) {
  button.setAttribute("aria-expanded", String(expanded));
}

function closeSubmenu() {
  if (!activeToggle) return;

  setExpanded(activeToggle, false);
  document.getElementById(activeToggle.getAttribute("aria-controls")).hidden = true;
  activeToggle = null;
}

function closeMenu() {
  closeSubmenu();
  setExpanded(menu, false);
}

menu.addEventListener("click", () => {
  if (menu.getAttribute("aria-expanded") === "true") {
    closeMenu();
  } else {
    setExpanded(menu, true);
  }
});

for (const toggle of navigation.querySelectorAll(".category-toggle")) {
  toggle.addEventListener("click", () => {
    const opening = activeToggle !== toggle;
    closeSubmenu();

    if (opening) {
      activeToggle = toggle;
      setExpanded(toggle, true);
      document.getElementById(toggle.getAttribute("aria-controls")).hidden = false;
    }
  });
  toggle.hidden = false;
}

document.addEventListener("click", (event) => {
  if (!navigation.contains(event.target)) closeMenu();
});

document.addEventListener("focusin", (event) => {
  if (!navigation.contains(event.target)) {
    closeMenu();
  } else if (activeToggle && !activeToggle.closest(".nav-item").contains(event.target)) {
    closeSubmenu();
  }
});

navigation.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  if (activeToggle) {
    const toggle = activeToggle;
    closeSubmenu();
    toggle.focus();
    event.preventDefault();
  } else if (menu.getAttribute("aria-expanded") === "true") {
    closeMenu();
    menu.focus();
    event.preventDefault();
  }
});

desktop.addEventListener("change", closeMenu);

menu.hidden = false;
navigation.dataset.ready = "";
