import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { renderNavbar } from '../../docs/navbar/render.mjs'

export default defineConfig(({ mode }) => {
  const projectLab = mode === 'project-lab'
  const pages = new URL('../../docs/', import.meta.url)

  return {
    base: './',
    plugins: [
      vue(),
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
          handler(html) {
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
        outDir: fileURLToPath(new URL('experiments/evolution-simulator/', pages)),
        emptyOutDir: true,
      } : {}),
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'three-core', test: /three\/build\/three\.core\.js$/ },
              { name: 'simulation', test: /\/src\/(engine\/|(?:archive|store|track)\.js$)/ },
            ],
          },
        },
      },
    },
  }
})
