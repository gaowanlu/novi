import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // 放宽：上下文文件里 hook 与 Provider 同文件导出是常见且合理的写法，
      // 允许以 use 开头的导出（useAuth / useSessionUser / useVault）。
      'react-refresh/only-export-components': [
        'error',
        { allowExportNames: ['useAuth', 'useSessionUser', 'useVault'] },
      ],
    },
  },
  {
    // 组件文件里 cva 生成的样式常量（*Variants）随组件导出，
    // 这是 shadcn/ui 的标准写法，单独放行。
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': [
        'error',
        {
          allowExportNames: [
            'tabsListVariants',
            'buttonVariants',
            'badgeVariants',
            'buttonGroupVariants',
            'markerVariants',
            'sidebarMenuButtonVariants',
            'useSidebar',
          ],
        },
      ],
    },
  },
])
