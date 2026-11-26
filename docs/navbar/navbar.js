{
  const header = document.currentScript.parentElement;
  const compactLayout = window.matchMedia("(width < 35rem), (hover: none)");
  let menuOpenedOnHover = false;
  let openCategory;
  let panelCloseTimer;
  let panelSwitchTimer;
  let navbarParsed = false;
  let setupSearch;
  let search;
  let pendingSearch;

  function setExpanded(control, expanded) {
    control?.setAttribute("aria-expanded", String(expanded));
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
    openCategory = undefined;
  }

  function showPanel(link) {
    if (openCategory?.link === link) return;
    const item = link.closest(".nav-item");
    const panel = item.querySelector(".nav-panel");
    if (!panel) return;

    closeSearch();
    closePanel();
    openCategory = { item, link, panel };
    setExpanded(link, true);
    panel.hidden = false;
  }

  function closeMenu() {
    closePanel();
    setExpanded(header.querySelector(".menu-toggle"), false);
    menuOpenedOnHover = false;
  }

  function syncCategoryLayout() {
    for (const item of header.querySelectorAll(".nav-item")) {
      const link = item.querySelector(".category-link");
      const panel = item.querySelector(".nav-panel");
      if (!link || !panel) continue;
      panel.hidden = !compactLayout.matches;
      if (compactLayout.matches) link.removeAttribute("aria-expanded");
      else setExpanded(link, false);
    }
  }

  function startSearch() {
    if (!navbarParsed || !setupSearch || !pendingSearch) return;

    const group = pendingSearch.closest(".nav-search");
    pendingSearch = undefined;
    const pages = Array.from(header.querySelectorAll("[data-nav-search]"), (link) => ({
      name: link.textContent.trim(),
      url: link.href,
    }));
    search = setupSearch(group, pages, closeMenu);
    search.refresh();
  }

  function requestSearch(event) {
    if (search || !event.target.matches(".nav-search input")) return;

    closeMenu();
    pendingSearch = event.target;
    startSearch();
  }

  function closeSearch() {
    const hadPendingQuery = Boolean(pendingSearch?.value.trim());
    pendingSearch = undefined;
    return search?.close() || hadPendingQuery;
  }

  // Delegate interactions before the parser reaches any of the controls.
  header.addEventListener("click", (event) => {
    requestSearch(event);
    const menu = event.target.closest(".menu-toggle");
    if (!menu) return;

    if (menuOpenedOnHover && event.detail > 0) {
      menuOpenedOnHover = false;
    } else if (menu.getAttribute("aria-expanded") === "true") {
      closeMenu();
    } else {
      closeSearch();
      setExpanded(menu, true);
    }
  });

  header.addEventListener("pointerover", (event) => {
    const group = event.target.closest(".nav-menu");
    if (group && !group.contains(event.relatedTarget)) clearTimeout(panelCloseTimer);

    const menu = event.target.closest(".menu-toggle");
    if (!menu || menu.contains(event.relatedTarget) || event.pointerType === "touch" ||
        menu.getAttribute("aria-expanded") === "true") return;

    closeSearch();
    menuOpenedOnHover = true;
    setExpanded(menu, true);
  });

  header.addEventListener("pointerout", (event) => {
    const link = event.target.closest(".category-link");
    if (link && !link.contains(event.relatedTarget)) cancelPanelSwitch();

    const group = event.target.closest(".nav-menu");
    if (!group || group.contains(event.relatedTarget)) return;
    if (menuOpenedOnHover && !group.contains(document.activeElement)) closeMenu();
    if (openCategory && !openCategory.item.querySelector(":focus-visible")) {
      panelCloseTimer = setTimeout(() => {
        if (!openCategory?.item.querySelector(":focus-visible")) closePanel();
      }, 150);
    }
  });

  header.addEventListener("pointermove", (event) => {
    const link = event.target.closest(".category-link");
    if (!link || event.pointerType === "touch" || compactLayout.matches ||
        openCategory?.panel.contains(document.activeElement)) return;

    // A gap disappearing under a stationary pointer shouldn't reopen a panel.
    if (!openCategory) {
      showPanel(link);
    } else if (openCategory.link !== link && panelSwitchTimer === undefined) {
      // Give the pointer time to cross another button on the way to the open panel.
      panelSwitchTimer = setTimeout(() => {
        panelSwitchTimer = undefined;
        if (link.matches(":hover") && !openCategory?.panel.contains(document.activeElement)) showPanel(link);
      }, 50);
    }
  });

  header.addEventListener("focusin", (event) => {
    requestSearch(event);
    if (!compactLayout.matches && event.target.matches(".category-link:focus-visible")) showPanel(event.target);
  });

  header.addEventListener("focusout", (event) => {
    if (event.target === pendingSearch) pendingSearch = undefined;
  });

  header.addEventListener("input", requestSearch);

  header.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" || compactLayout.matches || !event.target.matches(".category-link")) return;

    showPanel(event.target);
    if (!openCategory) return;
    event.preventDefault();
    openCategory.panel.querySelector("a")?.focus();
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".nav-search")) closeSearch();
    if (!header.contains(event.target)) closeMenu();
  });

  document.addEventListener("focusin", (event) => {
    if (!event.target.closest(".nav-search")) closeSearch();
    if (!header.contains(event.target)) {
      closeMenu();
    } else if (openCategory && !openCategory.item.contains(event.target)) {
      closePanel();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.isComposing) return;

    const menu = header.querySelector(".menu-toggle");
    if (closeSearch()) {
      event.preventDefault();
    } else if (openCategory) {
      if (openCategory.panel.contains(document.activeElement)) openCategory.link.focus();
      closePanel();
      event.preventDefault();
    } else if (menu?.getAttribute("aria-expanded") === "true") {
      closeMenu();
      menu.focus();
      event.preventDefault();
    }
  });

  compactLayout.addEventListener("change", () => {
    closeMenu();
    syncCategoryLayout();
  });

  header.addEventListener("navbar-parsed", () => {
    navbarParsed = true;
    if (compactLayout.matches) syncCategoryLayout();
    startSearch();

    const compactPanel = header.querySelector(".nav-links");
    const reservePanelSpace = new ResizeObserver(() => {
      const height = compactPanel.getBoundingClientRect().height;
      header.style.setProperty("--nav-panel-height", `${height}px`);
    });
    reservePanelSpace.observe(compactPanel, { box: "border-box" });
  }, { once: true });

  const searchModuleURL = document.getElementById("navbar-search-module").href;
  import(searchModuleURL).then(({ setupNavbarSearch }) => {
    setupSearch = setupNavbarSearch;
    startSearch();
  }, () => {
    pendingSearch = undefined;
  });
}
