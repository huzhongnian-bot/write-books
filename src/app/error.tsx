"use client";

import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";

// App Router 全局错误兜底：RSC 渲染抛错时替代 Next 默认错误页
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="container mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="text-2xl font-bold tracking-tight">页面出错了</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        渲染页面时发生了意外错误。可以点击「重试」重新加载，或返回项目列表继续其他操作。
      </p>
      <div className="mt-8 flex items-center gap-3">
        <Button onClick={reset}>重试</Button>
        <Link href="/projects" className={buttonVariants({ variant: "outline" })}>
          返回项目列表
        </Link>
      </div>
    </main>
  );
}
