// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * Simulation-layer folders (ARCHITECTURE.md §2). Code here must run headlessly in Node,
 * so it may not import presentation code or touch browser globals.
 */
const SIMULATION = [
  'core',
  'config',
  'modifiers',
  'utils',
  'physics',
  'navigation',
  'player',
  'weapons',
  'combat',
  'enemies',
  'bosses',
  'waves',
  'adaptive',
  'progression',
  'signal',
  'world',
].map((dir) => `src/${dir}/**/*.ts`);

/** Presentation files that live inside simulation folders, identified by name. */
const PRESENTATION_IN_SIMULATION = [
  'src/**/*View.ts',
  'src/player/CameraController.ts',
  'src/world/LightingController.ts',
];

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/'] },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },

  // Layer boundary: simulation must not depend on presentation or the browser (D-003).
  {
    files: SIMULATION,
    ignores: PRESENTATION_IN_SIMULATION,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/render/**',
                '**/ui/**',
                '**/audio/**',
                '**/effects/**',
                '**/debug/**',
                '**/*View',
                '**/*View.ts',
              ],
              message:
                'Simulation code must not import presentation code (ARCHITECTURE.md §2, D-003).',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...['window', 'document', 'navigator', 'localStorage', 'requestAnimationFrame'].map(
          (name) => ({
            name,
            message: 'Simulation code must run headlessly; use a platform service (D-003).',
          }),
        ),
      ],
    },
  },

  // Platform layer: input/ receives window, document and the canvas by injection from main.ts,
  // so it stays testable in Node and never reaches for browser globals itself (D-034).
  {
    files: ['src/input/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/render/**', '**/ui/**', '**/audio/**', '**/effects/**', '**/*View'],
              message: 'Input code must not import presentation code (ARCHITECTURE.md §2).',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...['window', 'document', 'navigator', 'localStorage', 'requestAnimationFrame'].map(
          (name) => ({
            name,
            message: 'Input code receives browser objects by injection from main.ts (D-034).',
          }),
        ),
      ],
    },
  },

  // End-to-end specs: browser-side page scripts look up elements and window.tls that the test has
  // just established, so non-null assertions are the clearest way to say so there (D-036).
  {
    files: ['tests/e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Config files run in Node and are not part of the typed project.
  {
    files: ['eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },

  prettier,
);
