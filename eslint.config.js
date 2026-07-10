import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const runtimeGlobals = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly',
  localStorage: 'readonly', performance: 'readonly', requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
  setInterval: 'readonly', clearInterval: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
  HTMLElement: 'readonly', HTMLCanvasElement: 'readonly', MouseEvent: 'readonly', PointerEvent: 'readonly',
  KeyboardEvent: 'readonly', AudioContext: 'readonly', Image: 'readonly', fetch: 'readonly',
  console: 'readonly', process: 'readonly', Buffer: 'readonly', getComputedStyle: 'readonly'
};

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: runtimeGlobals },
    rules: { 'no-empty': 'off', 'no-useless-assignment': 'off' }
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: runtimeGlobals },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-constant-condition': 'off',
      'no-empty': 'off',
      'no-useless-assignment': 'off'
    }
  }
);
