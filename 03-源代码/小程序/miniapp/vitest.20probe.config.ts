/**
 * 临时探针配置（20 号自用，验收后删除）
 * 目的：把 vitest 结果落到文件，避免 PowerShell 管道缓冲导致进程卡死（本波实测踩过）。
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/pages/family/__tests__/**/*.test.tsx'],
    testTimeout: 15000,
    reporters: [['json', { outputFile: 'E:/星河宠记/.work-tmp/packages/_20-probe-result.json' }]],
  },
})
