import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'
import { workflow } from 'workflow/vite'

export default defineConfig(({ mode }) => ({
  server: {
    port: 3000,
    watch: {
      ignored: ['**/.workflow-data/**', '**/.swc/**'],
    },
  },
  plugins:
    mode === 'test'
      ? [react()]
      : [
          workflow(),
          tanstackStart({ router: { routeTreeFileHeader: [] } }),
          react(),
          nitro(),
        ],
  resolve: {
    tsconfigPaths: true,
  },
}))
