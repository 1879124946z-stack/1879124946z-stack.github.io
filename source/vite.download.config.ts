import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
export default defineConfig({root:resolve('github-src'),base:'./',publicDir:false,build:{outDir:resolve('download-dist'),emptyOutDir:true},plugins:[react(),{name:'download-entry',transformIndexHtml:{order:'pre',handler:html=>html.replace('/main.tsx','/download.tsx')}}]});
