const reference = document.querySelector('#reference')
const form = reference.querySelector('.reference-search')
const input = form.querySelector('input')
const clear = form.querySelector('button')
const count = reference.querySelector('.reference-count')
const links = new Map(Array.from(reference.querySelectorAll('.reference-index li'), item =>
  [item.firstElementChild.hash.slice(1), item]))

const groups = Array.from(reference.querySelectorAll('.reference-group'), group => ({
  group,
  sections: Array.from(group.querySelectorAll('.reference-section'), section => ({
    section,
    entries: Array.from(section.querySelectorAll('.reference-entry'), entry => ({
      entry,
      text: [
        group.firstElementChild.textContent,
        section.firstElementChild.textContent,
        entry.textContent,
      ].join(' ').toLowerCase(),
    })),
  })),
}))

function filter() {
  const words = input.value.toLowerCase().trim().split(/\s+/).filter(Boolean)
  let matches = 0
  for (const { group, sections } of groups) {
    let groupMatches = 0
    for (const { section, entries } of sections) {
      let sectionMatches = 0
      for (const { entry, text } of entries) {
        const match = words.every(word => text.includes(word))
        entry.hidden = !match
        sectionMatches += Number(match)
      }
      section.hidden = sectionMatches === 0
      groupMatches += sectionMatches
    }
    group.hidden = groupMatches === 0
    links.get(group.id).hidden = group.hidden
    matches += groupMatches
  }
  clear.disabled = !input.value
  count.textContent = matches === 0 ? 'No matches. Try a button name or a shorter search.'
    : words.length ? `${matches} matching ${matches === 1 ? 'entry' : 'entries'}` : ''
}

input.addEventListener('input', filter)
form.addEventListener('submit', event => event.preventDefault())
form.addEventListener('reset', event => {
  event.preventDefault()
  input.value = ''
  filter()
  input.focus()
})
reference.querySelector('.reference-print').addEventListener('click', () => window.print())
reference.querySelector('.reference-tools').hidden = false
filter()
