// Demo web: página estática que firma transacciones en Stellar testnet desde el navegador.
// El SDK de Stellar va como bundle en public/stellar-sdk.min.js (global StellarSdk).
// El build sale a ../docs, que es lo que sirve GitHub Pages.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: '../docs', emptyOutDir: true, assetsInlineLimit: 200_000 },
})
