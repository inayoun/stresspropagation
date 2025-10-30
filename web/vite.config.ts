import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  base: '/StressPropagation/',
  build: {
    lib: {
      entry: 'src/main.ts',
      name: 'StressPropagation',
      fileName: (format) => `stress-propagation.${format}.js`,
    },
    rollupOptions: {
      external: ['d3'],
      output: {
        globals: {
          d3: 'd3',
        },
      },
    },
  },
  plugins: [dts()],
});
