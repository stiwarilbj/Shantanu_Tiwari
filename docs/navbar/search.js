const maxResults = 7;

function normalizeName(name) {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function editDistance(query, word) {
  const rows = [Array.from({ length: word.length + 1 }, (_, index) => index)];
  for (let row = 1; row <= query.length; row++) {
    rows[row] = [row];
    for (let column = 1; column <= word.length; column++) {
      const replacement = query[row - 1] === word[column - 1] ? 0 : 1;
      let distance = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + replacement,
      );
      if (row > 1 && column > 1 &&
          query[row - 1] === word[column - 2] && query[row - 2] === word[column - 1]) {
        distance = Math.min(distance, rows[row - 2][column - 2] + 1);
      }
      rows[row][column] = distance;
    }
  }
  return rows[query.length][word.length];
}

function closestWordDistance(term, words, limit) {
  let closest = Infinity;
  for (const word of words) {
    // Compare word beginnings too, so a typo can be corrected before the word is finished.
    const lastLength = Math.min(word.length, term.length + limit);
    for (let length = term.length - limit; length <= lastLength; length++) {
      closest = Math.min(closest, editDistance(term, word.slice(0, length)));
    }
  }
  return closest;
}

function matchScore(page, query, terms) {
  if (page.normalized === query) return 0;
  if (page.normalized.startsWith(query)) return 1;
  if (page.normalized.includes(query)) return 2;

  let score = 3;
  for (const term of terms) {
    if (page.normalized.includes(term)) continue;
    if (term.length < 3) return Infinity;

    const limit = term.length >= 5 ? 2 : 1;
    const distance = closestWordDistance(term, page.words, limit);
    if (distance > limit) return Infinity;
    score += distance;
  }
  return score;
}

export function setupNavbarSearch(group, pages, closeMenu) {
  const input = group.querySelector("input");
  const results = group.querySelector(".nav-search-results");
  const listbox = group.querySelector('[role="listbox"]');
  const emptyMessage = group.querySelector(".nav-search-empty");
  const catalog = pages.map((page) => {
    const normalized = normalizeName(page.name);
    return { ...page, normalized, words: normalized.split(/[^\p{L}\p{N}]+/u) };
  });
  let options = [];
  let activeIndex = -1;

  function close() {
    if (results.hidden) return false;

    results.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    return true;
  }

  function refresh() {
    closeMenu();
    close();
    const query = normalizeName(input.value);
    if (!query) return;

    const terms = query.split(" ");
    const matches = catalog
      .map((page) => ({ page, score: matchScore(page, query, terms) }))
      .filter(({ score }) => Number.isFinite(score))
      .sort((left, right) => left.score - right.score)
      .slice(0, maxResults);

    activeIndex = -1;
    options = [];
    const rows = matches.map(({ page }, index) => {
      const row = document.createElement("li");
      row.setAttribute("role", "presentation");
      const option = document.createElement("a");
      option.id = `nav-search-option-${index}`;
      option.href = page.url;
      option.textContent = page.name;
      option.tabIndex = -1;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      row.append(option);
      options.push(option);
      return row;
    });
    listbox.replaceChildren(...rows);
    listbox.hidden = options.length === 0;
    emptyMessage.hidden = options.length > 0;
    results.hidden = false;
    input.setAttribute("aria-expanded", String(options.length > 0));
  }

  input.addEventListener("focus", refresh);
  input.addEventListener("click", () => {
    if (results.hidden) refresh();
  });
  input.addEventListener("input", refresh);
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (results.hidden) refresh();
      if (!options.length || results.hidden) return;

      event.preventDefault();
      options[activeIndex]?.setAttribute("aria-selected", "false");
      if (event.key === "ArrowDown") {
        activeIndex = (activeIndex + 1) % options.length;
      } else {
        activeIndex = activeIndex <= 0 ? options.length - 1 : activeIndex - 1;
      }
      const active = options[activeIndex];
      active.setAttribute("aria-selected", "true");
      input.setAttribute("aria-activedescendant", active.id);
      active.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && !results.hidden && options.length) {
      event.preventDefault();
      (options[activeIndex] ?? options[0]).click();
    }
  });

  return { close, refresh };
}
