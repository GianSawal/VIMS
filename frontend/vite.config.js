import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

// Proxy API/media to Django so the session + CSRF cookies are same-origin in dev.
export default defineConfig(({ mode }) => {
  const target = loadEnv(mode, process.cwd()).VITE_API_TARGET || 'http://127.0.0.1:8000'
  return {
    plugins: [react(), tailwindcss()],
    server: { proxy: { '/api': target, '/media': target } },
  }
})
