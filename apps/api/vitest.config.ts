import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

// swc (not esbuild) so decorator metadata survives — TypeORM/Nest need it.
export default defineConfig({
  test: { include: ['src/**/*.spec.ts'] },
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2022',
      },
    }),
  ],
});
