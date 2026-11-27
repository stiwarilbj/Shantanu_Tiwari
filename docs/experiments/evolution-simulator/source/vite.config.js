import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { renderNavbar } from '../../../navbar/render.mjs'
import { renderReference } from './src/reference/render.js'

const indexPage = fileURLToPath(new URL('./index.html', import.meta.url))
const referencePage = fileURLToPath(new URL('./reference.html', import.meta.url))
const worldModule = fileURLToPath(new URL('./src/components/World.vue', import.meta.url))

function preloadWorldEntrance(html, { bundle, filename }) {
  if (filename !== indexPage) return []
  const world = Object.values(bundle).find(chunk => chunk.type === 'chunk' && chunk.facadeModuleId === worldModule)
  if (!world) throw new Error('Could not find the World entry for the simulator build')

  const modules = new Set()
  const styles = new Set()
  function collect(chunk) {
    if (modules.has(chunk.fileName)) return
    modules.add(chunk.fileName)
    for (const file of chunk.viteMetadata?.importedCss ?? []) styles.add(file)
    for (const file of chunk.imports) if (bundle[file]?.type === 'chunk') collect(bundle[file])
  }
  collect(world)

  const notLinked = file => !html.includes(`href="./${file}"`) && !html.includes(`src="./${file}"`)
  // Vite fetches the smaller dependencies when World is imported. Preloading those
  // here as well competes with the larger renderer downloads on slow connections.
  const preloads = [
    ...[...modules].filter(file => notLinked(file) && bundle[file].code.length >= 12000)
      .sort((a, b) => bundle[b].code.length - bundle[a].code.length)
      .map(file => [`./${file}`, 'modulepreload']),
    ...[...styles].filter(notLinked).map(file => [`./${file}`, 'preload']),
  ]
  // The fragment is available to the browser before the app's entry module runs.
  return [{
    tag: 'script',
    injectTo: 'head-prepend',
    children: `if (!location.hash || location.hash === '#/') {
      for (const [href, rel] of ${JSON.stringify(preloads)}) {
        const link = document.createElement('link')
        link.rel = rel
        if (href.includes('/three-')) link.fetchPriority = 'high'
        if (rel === 'preload') link.as = 'style'
        link.crossOrigin = ''
        link.href = href
        document.head.append(link)
      }
    }`,
  }]
}

export default defineConfig(({ mode }) => {
  const projectLab = mode === 'project-lab'

  return {
    base: './',
    plugins: [
      vue(),
      {
        name: 'simulator-controls-reference',
        transformIndexHtml: {
          order: 'pre',
          handler(html, { filename }) {
            return filename === referencePage ? renderReference(html) : html
          },
        },
      },
      {
        name: 'world-entrance-preload',
        apply: 'build',
        transformIndexHtml: { order: 'post', handler: preloadWorldEntrance },
      },
      projectLab && {
        name: 'project-lab-page',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'project-lab.css',
            source: readFileSync(new URL('project-lab.css', import.meta.url)),
          })
        },
        transformIndexHtml: {
          order: 'post',
          handler(html, { filename }) {
            if (filename === referencePage) {
              const reference = html.replace('<body class="reference-page">',
                '<body class="reference-page">\n    <header data-site-navbar></header>')
              return renderNavbar(reference, 'experiments/evolution-simulator/reference.html')
            }
            const page = html
              .replace('  </head>', '    <link rel="stylesheet" href="./project-lab.css">\n  </head>')
              .replace('<body>', '<body class="project-lab-page">\n    <header data-site-navbar></header>\n')
            return renderNavbar(page, 'experiments/evolution-simulator/index.html')
          },
        },
      },
    ],
    build: {
      license: { fileName: 'licenses/dependencies.md' },
      ...(projectLab ? {
        outDir: '.pages-build',
        emptyOutDir: true,
      } : {}),
      rolldownOptions: {
        input: { index: indexPage, reference: referencePage },
        output: {
          codeSplitting: {
            groups: [
              { name: 'three-core', test: /three\/build\/three\.core\.js$/ },
              { name: 'three-renderer', test: /three\/build\/three\.module\.js$/ },
              { name: 'simulation', test: /\/src\/(engine\/|(?:archive|store|track)\.js$)/ },
            ],
          },
        },
      },
    },
  }
})
