/**
 * 测试专用：Node 内置模块的最小类型声明
 *
 * 背景：小程序包的 tsconfig 只声明了 `types: ["@tarojs/taro"]`（不引入 @types/node），
 * 所以 `import { readFileSync } from 'node:fs'` 会报 TS2307。
 *
 * 为什么需要：有些「约定回归锁」必须读源码文本才能锁住 —— 例如
 * PageBackground.scss 的 `.xhh-bg` 必须 z-index: -1，写成 0 会让不透明背景层
 * 盖住整页静态内容（2026-09-10 全站空白事故）；组件测试只渲染 DOM，
 * 拿不到层叠计算结果，锁不住这类问题。
 *
 * 只声明用到的那一个函数，避免整套 Node 全局类型（process/Buffer/setTimeout 重载）
 * 污染小程序运行时代码的类型环境。
 */
declare module 'node:fs' {
  export function readFileSync(filePath: string, encoding: 'utf-8'): string
}
