import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  plugins:
    mode === 'test'
      ? [react()]
      : [
          tanstackStart({ router: { routeTreeFileHeader: [] } }),
          react(),
          nitro(),
        ],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    port: 3000,
  },
}))
