// ============================================================================
// فحص لغوي للواجهة — القواعد التي تلتقط أعطالاً حقيقية لا التي تُجادل في الشكل.
//
// react-hooks/exhaustive-deps هنا ليس تزيّناً: عطل عارض المرفقات (رابط blob
// يُبطَل فور إنشائه) كان بالضبط اعتمادية زائدة في useEffect.
// ============================================================================

import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks, react },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // بلا هاتين يظنّ no-unused-vars كل مكوّن مستورد غير مستعمل.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      'no-unused-vars': [
        'error',
        // `catch (_)` نمط قائم في المنصة: الخطأ مُتجاهَل عن قصد.
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-console': 'warn',
    },
  },
];
