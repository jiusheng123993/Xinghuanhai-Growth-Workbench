/**
 * Taro 项目配置（纯 JS 版）
 *
 * 说明：原 config/index.ts 在 Node 18/24 的 TS 转译链路上不稳定，
 * 这里直接用同内容的 .js（Taro 解析配置时 .js 优先于 .ts），保证构建可复现。
 */
const { defineConfig } = require('@tarojs/cli')
const path = require('path')

const isH5 = process.env.TARO_ENV === 'h5'

const config = {
  projectName: 'xinghechongji-miniapp',
  date: '2024-07-22',
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2,
    375: 2,
  },
  sourceRoot: 'src',
  outputRoot: isH5 ? 'dist-h5' : 'dist',
  plugins: isH5 ? [] : [
    path.join(__dirname, 'plugin-ensure-wxss.ts'),
  ],
  defineConstants: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
    'process.env.TARO_ENV': JSON.stringify(process.env.TARO_ENV || 'weapp'),
    ENABLE_INNER_HTML: JSON.stringify(false),
    ENABLE_ADJACENT_HTML: JSON.stringify(false),
    ENABLE_CLONE_NODE: JSON.stringify(false),
    ENABLE_SIZE_APIS: JSON.stringify(false),
    ENABLE_TEMPLATE_CONTENT: JSON.stringify(false),
  },
  copy: {
    patterns: [
      // 微信原生组件（chooseAvatar/nickname 能力，Taro 编译层不支持这两个属性，
      // 用原生 wxml/js 实现并通过 usingComponents 引入，这里显式拷贝进 dist）
      { from: 'src/components/WechatProfile', to: 'dist/components/WechatProfile' },
      // 分主题 tabBar 图标：themeStore 里是用运行时字符串拼路径（拼给 setTabBarItem），
      // webpack 静态分析看不到这些文件，不显式拷贝的话真机切主题时图标会 404。
      // 默认配色那套（autumn/grid）路径写在 app.config.ts 里，会被自动带进去，无需在此声明。
      { from: 'src/assets/icons/tabbar', to: 'dist/assets/icons/tabbar' },
    ],
    options: {},
  },
  // 框架统一用 react：曾实验 framework: 'preact'（主包体积优化），
  // 但 Taro 3.6.40 + babel-preset-taro 4.x 混装下 preact 绑定不完整，
  // 产物 createReactApp 拿到的 react-dom 无 createRoot，真机白屏
  // （TypeError: y.createRoot is not a function）。已回滚，保留实验备份
  // config/index.js.bak-react 与 git HEAD 供后续对齐版本后再试。
  framework: 'react',
  compiler: 'webpack5',
  cache: {
    enable: false,
  },
  mini: {
    postcss: {
      pxtransform: {
        enable: true,
        config: {},
      },
      url: {
        enable: true,
        config: {
          limit: 1024,
        },
      },
      cssModules: {
        enable: false,
        config: {
          namingPattern: 'module',
          generateScopedName: '[name]__[local]___[hash:base64:5]',
        },
      },
    },
    webpackChain(chain) {
      chain.merge({
        ignoreWarnings: [/Conflicting order/],
      })
      // 关闭 symlink 解析：E:\xinghechongji 是指向 E:\星河宠记 的符号链接，
      // 不关闭时 webpack 解析出的真实路径与 sourceDir 不匹配，babel-loader 规则全部失效
      chain.resolve.symlinks(false)
      // 修复小程序运行时 "process is not defined" 错误
      // ProvidePlugin 提供 process 全局变量，defineConstants 中的 process.env.* 和 ENABLE_* 由 Taro 内置 DefinePlugin 处理
      chain.plugin('providePlugin').use(require('webpack').ProvidePlugin, [{
        process: [path.join(__dirname, '..', 'node_modules', 'process', 'browser.js')],
      }])
    },
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
    router: {
      mode: 'hash',
    },
    devServer: {
      port: 10086,
      host: '0.0.0.0',
    },
    postcss: {
      autoprefixer: {
        enable: true,
        config: {},
      },
      cssModules: {
        enable: false,
        config: {
          namingPattern: 'module',
          generateScopedName: '[name]__[local]___[hash:base64:5]',
        },
      },
    },
    webpackChain(chain) {
      chain.resolve.alias.set('@tarojs/runtime', '@tarojs/runtime')
      // 与 mini 端保持一致：关闭 symlink 解析，避免符号链接路径导致 babel 规则失效
      chain.resolve.symlinks(false)
      // 与 mini 端保持一致：提供 process 全局变量，修复 H5 运行时 "process is not defined"
      //（否则 H5 构建的页面会白屏，无法预览）
      chain.plugin('providePlugin').use(require('webpack').ProvidePlugin, [{
        process: [path.join(__dirname, '..', 'node_modules', 'process', 'browser.js')],
      }])
    },
  },
  alias: {
    '@': 'src',
  },
  env: {
    // 线上 API 域名：与情侣消消乐共用服务器，走 api 子域名 + HTTPS（微信合法域名要求）
    TARO_APP_API_BASE_URL: JSON.stringify(process.env.TARO_APP_API_BASE_URL || 'https://api.xinghuanhai.com'),
    TARO_APP_USE_MOCK: JSON.stringify(process.env.TARO_APP_USE_MOCK || 'false'),
    TARO_APP_SUPABASE_URL: JSON.stringify(process.env.TARO_APP_SUPABASE_URL || ''),
    TARO_APP_SUPABASE_KEY: JSON.stringify(process.env.TARO_APP_SUPABASE_KEY || ''),
    TARO_APP_CRYPTO_SALT: JSON.stringify(process.env.TARO_APP_CRYPTO_SALT || ''),
    TARO_APP_FOLLOWUP_TEMPLATE_ID: JSON.stringify(process.env.TARO_APP_FOLLOWUP_TEMPLATE_ID || ''),
    TARO_APP_CARE_PLAN_TEMPLATE_ID: JSON.stringify(process.env.TARO_APP_CARE_PLAN_TEMPLATE_ID || ''),
    TARO_APP_HEALTH_CHECKIN_TEMPLATE_ID: JSON.stringify(process.env.TARO_APP_HEALTH_CHECKIN_TEMPLATE_ID || ''),
    TARO_APP_VACCINE_REMINDER_TEMPLATE_ID: JSON.stringify(process.env.TARO_APP_VACCINE_REMINDER_TEMPLATE_ID || ''),
  },
}

module.exports = function (merge) {
  if (process.env.NODE_ENV === 'development') {
    return merge({}, config, {
      mini: {
        sourceMapType: 'cheap-module-source-map',
      },
    })
  }
  return merge({}, config, {
    mini: {
      // "主包体积优化"（MiniSplitChunksPlugin）：把仅被分包引用的共享代码提取到
      // 分包 root 的 sub-common/sub-vendors，避免塞进主包 common.js（主包保持 1.32M）。
      // 注意：微信"代码质量-主包大小"检查会把这两个目录计入"主包"统计（对照实验证实，
      // 1.32M 主包 + 0.68M 分包公共 ≈ 2M 永远超 1.5M 检查线）。经尝试 exclude 内联、
      // 关闭 optimizeMainPackage 均不可行（共享代码会进主包 common 使主包 1.76M+）。
      // 结论：这是 Taro 产物结构与微信统计口径的固有冲突，该检查为建议项不影响
      // 上传/发布/审核（上传 3.5MB 成功），维持本配置。
      optimizeMainPackage: {
        enable: true,
      },
    },
  })
}
