<!-- BEGIN:nextjs-agent-rules -->

# Next.js: ALWAYS read docs before coding

Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.

<!-- END:nextjs-agent-rules -->

# Write Books

Next.js 16.2 + React 19 + Tailwind 4 + shadcn/ui 4.x (base-nova) + TS 5 strict。别名 `@/*` → `src/*`，UI 组件在 `src/components/ui/`，样式用 `cn()`。

- `params`/`searchParams` 是 Promise 必须 `await`；默认 Server Component，仅交互时加 `"use client"`
- lucide ≥1.23.0 无品牌图标用内联 SVG；`@base-ui/react/button` 不支持 `asChild`；TW4 用 `@import "tailwindcss"`
