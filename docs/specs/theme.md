# 规格：文学主题换肤（theme）

> 对应模块：产品体验层（横切）；实现：`projects.theme`、`src/app/globals.css` 的 `[data-theme]` token 块、`src/app/projects/[id]/layout.tsx` + `theme-skin.tsx` + `theme-picker.tsx`、`src/lib/themes.ts`。
> 关联：产品文档 §九（用户分层——分层做在引导密度上；换肤同属体验层，不动数据模型语义）。

## 一、背景与目标

不同文学题材的创作氛围不同：写校园文和写星际科幻的作者对界面气质的预期完全不同。换肤是**纯体验层**能力——只改视觉 token，不动任何数据与流程语义。P0 适配五套主题：

| value | 题材 | 气质 |
|---|---|---|
| `default` | — | 不换肤（现有 base-nova 默认） |
| `campus` | 校园文学 | 清爽春日绿、圆角加大、明亮 |
| `western` | 西方幻想 | 羊皮纸底色、青铜主色、衬线字体 |
| `eastern` | 东方武侠 | 墨色暗底、朱砂主色、金色点缀、楷体 |
| `urban` | 都市文学 | 石墨灰、靛蓝主色、冷峻现代 |
| `scifi` | 星际科幻 | 深空暗底、青色辉光、圆角收小、星点背景 |

## 二、设计

### 2.1 数据约定

- `projects.theme`（text，默认 `"default"`）：皮肤是**项目级**设置——题材是作品的属性，不是全局偏好
- 合法值由 `schema.ts` 的 `projectThemeEnum` 定义；**新增主题须三处同步**：`projectThemeEnum`、`globals.css` 新增 `[data-theme]` token 块、`src/lib/themes.ts` 的 `PROJECT_THEME_OPTIONS`
- 上传建项目时可选主题（`POST /api/works` 的 `theme` 字段，缺省 default，非法值 400）；之后可随时改（`setProjectTheme` Server Action）

### 2.2 换肤机制（Tailwind 4 CSS-first）

- 全部 shadcn 组件消费语义 token（`--background/--primary/--border/...`），换肤 = 在 `html[data-theme="x"]` 下重定义同一组变量；字体与圆角同理（`font-family`、`--radius`）
- `data-theme` 挂在 `<html>` 上（不是页面 wrapper div）：弹层/Toast 经 portal 挂载到 body，也能吃到主题
- `ThemeSkin`（client）：SSR 渲染内联脚本抢在首帧前设置 `data-theme`（避免闪切）；客户端导航由 effect 同步；离开项目工作区（卸载）还原默认皮
- 主题切换器在 `[id]/layout.tsx` 顶部窄栏（工作区四页共享）：选择后**立即**改 `data-theme`（不等服务端），再调 action 持久化，失败回滚 + toast

### 2.3 影响面边界

- 只作用于项目工作区（`/projects/[id]/**`）；项目列表、`/design/*` 保持默认皮
- 纯 CSS 变量切换，无 JS 主题计算、无 webfont 下载（字体用系统栈：楷体/宋体/Georgia 等），离线可用

## 三、验收标准

- [x] 上传时选「星际科幻」→ 项目落库 `theme=scifi`；非法值 400（2026-07-25 curl 实测）
- [x] seed 演示项目为「东方武侠」：工作区页面 HTML 含 `dataset.theme="eastern"` 内联脚本（2026-07-25 实测）
- [x] 五套主题 token 块全部进入生产 CSS 产物（build 后 grep 实测）
- [x] `setProjectTheme` 单测：更新持久化 / 非法值拒绝 / 项目不存在报错（vitest 3 用例）
- [ ] 浏览器人工走查：五套皮肤逐一切换目视确认（含弹层、写作台三栏、Toast）
