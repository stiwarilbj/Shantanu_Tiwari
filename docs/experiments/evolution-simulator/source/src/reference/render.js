import { escapeHtml } from '../../../../../navbar/render.mjs'
import { groups } from './content.js'

export function renderReference(html) {
  const index = groups.map(({ id, title }) =>
    `<li><a href="#${id}">${escapeHtml(title)}</a></li>`).join('\n          ')
  const contents = groups.map(({ id, title, sections }) => `
      <section class="reference-group" id="${id}" aria-labelledby="${id}-title">
        <h2 id="${id}-title">${escapeHtml(title)}</h2>${sections.map(([location, entries]) => `
        <section class="reference-section">
          <h3>${escapeHtml(location)}</h3>
          <dl>${entries.map(([name, description]) => `
            <div class="reference-entry">
              <dt>${escapeHtml(name)}</dt>
              <dd>${escapeHtml(description)}</dd>
            </div>`).join('')}
          </dl>
        </section>`).join('')}
      </section>`).join('')

  return html
    .replace('<!-- Reference index -->', `<nav class="reference-index" aria-label="Reference sections">
        <ul>
          ${index}
        </ul>
      </nav>`)
    .replace('<!-- Reference content -->', contents.trim())
}
