import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  const projectLab = mode === 'project-lab'
  const pages = new URL('../../docs/', import.meta.url)

  return {
    base: './',
    plugins: [
      vue(),
      projectLab && {
        name: 'project-lab-navbar',
        transformIndexHtml: {
          order: 'post',
          handler(html) {
            const homepage = readFileSync(new URL('index.html', pages), 'utf8')
            const navbar = homepage.match(/src="\.\/navbar\/(navbar\.js\?v=\d+)"/)?.[1]
            if (!navbar) throw new Error('Could not find the shared navbar in the Project Lab homepage')

            return {
              html: html.replace(/^[ \t]*<link rel="icon"[^>]*>\r?\n/m, ''),
              tags: [
                { tag: 'link', attrs: { rel: 'icon', href: '../../assets/favicon.ico' }, injectTo: 'head' },
                { tag: 'script', attrs: { type: 'module', src: `../../navbar/${navbar}`, blocking: 'render' }, injectTo: 'head' },
                { tag: 'header', attrs: { 'data-site-navbar': true }, injectTo: 'body-prepend' },
              ],
            }
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
