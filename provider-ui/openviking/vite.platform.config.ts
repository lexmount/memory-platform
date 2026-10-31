import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tsconfigPaths from 'vite-tsconfig-paths'
export default defineConfig({resolve:{dedupe:Object.keys(require('./package.json').dependencies),alias:{'#':fileURLToPath(new URL('./src',import.meta.url)),'@hs':fileURLToPath(new URL('../hindsight/src',import.meta.url))}},plugins:[tsconfigPaths({projects:['./tsconfig.json']}),tailwindcss(),react()],
 build:{lib:{entry:{index:'src/platform/index.tsx',shared:'src/platform/shared.ts',hindsight:'src/platform/hindsight.tsx'},formats:['es'],cssFileName:'style'},rollupOptions:{external:['react','react-dom','react/jsx-runtime','react/jsx-dev-runtime','react-dom/client']},sourcemap:true},
})
