import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import sortImports from 'eslint-plugin-simple-import-sort';

export default tseslint.config(eslint.configs.recommended, ...tseslint.configs.recommended, {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
        ...prettier.rules,
        'simple-import-sort/imports': 'error',
        'simple-import-sort/exports': 'error',
    },
    plugins: {
        'simple-import-sort': sortImports,
    },
});
