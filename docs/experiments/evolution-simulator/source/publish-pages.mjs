import { cp, readdir, rename, rm } from 'node:fs/promises'

const build = new URL('./.pages-build/', import.meta.url)
const site = new URL('../', import.meta.url)
const generatedDirectories = ['assets/', 'licenses/']

for (const directory of generatedDirectories) {
  await cp(new URL(directory, build), new URL(directory, site), { recursive: true })
}
for (const file of ['favicon.svg', 'project-lab.css']) {
  await cp(new URL(file, build), new URL(file, site))
}
await rename(new URL('index.html', build), new URL('index.html', site))

// Keep the previous page's assets until the new page is in place.
for (const directory of generatedDirectories) {
  const destination = new URL(directory, site)
  const currentFiles = new Set(await readdir(new URL(directory, build)))
  for (const name of await readdir(destination)) {
    if (!currentFiles.has(name)) {
      await rm(new URL(name, destination), { recursive: true, force: true })
    }
  }
}
