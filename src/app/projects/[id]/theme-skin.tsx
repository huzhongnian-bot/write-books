"use client";

import { useEffect } from "react";

/**
 * 把项目主题写到 <html data-theme>：
 * - SSR 时渲染内联脚本，抢在首帧绘制前设置，避免「先默认皮后闪切」
 * - 客户端导航/换肤由 effect 同步；离开项目工作区（组件卸载）即还原默认皮
 */
export function ThemeSkin({ theme }: { theme: string }) {
  useEffect(() => {
    const el = document.documentElement;
    if (theme === "default") {
      delete el.dataset.theme;
    } else {
      el.dataset.theme = theme;
    }
    return () => {
      delete el.dataset.theme;
    };
  }, [theme]);

  const js =
    theme === "default"
      ? "delete document.documentElement.dataset.theme"
      : `document.documentElement.dataset.theme=${JSON.stringify(theme)}`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
