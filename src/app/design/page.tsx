"use client"

import { useState } from "react"
import Link from "next/link"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Toggle } from "@/components/ui/toggle"
import {
  Info,
  CheckCircle2,
  XCircle,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Mail,
  Search,
  Send,
  Bell,
  Heart,
  Star,
  Zap,
  Shield,
  Palette,
  Code2,
  Layers,
  Package,
  Sparkles,

  ArrowRight,
  Copy,
  Moon,
  Sun,
} from "lucide-react"

function SectionTitle({ children, description }: { children: React.ReactNode; description?: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-2xl font-bold tracking-tight">{children}</h2>
      {description && <p className="text-muted-foreground mt-1">{description}</p>}
      <Separator className="mt-4" />
    </div>
  )
}

function ComponentCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/50 bg-card p-4 shadow-sm">
      <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">{title}</p>
      {children}
    </div>
  )
}

export default function DesignShowcase() {
  const [switchOn, setSwitchOn] = useState(true)
  const [progress, setProgress] = useState(65)
  const [toggleBold, setToggleBold] = useState(false)
  const [toggleItalic, setToggleItalic] = useState(false)
  const [toggleUnderline, setToggleUnderline] = useState(false)
  const [checked, setChecked] = useState(true)
  const [darkMode, setDarkMode] = useState(false)

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <span className="text-lg font-bold">shadcn/ui</span>
            <Badge variant="secondary" className="ml-2 text-[10px]">组件展示</Badge>
          </div>
          <nav className="flex items-center gap-2">
            <Link href="/design/bible" className={buttonVariants({ variant: "ghost", size: "sm" })}>百科样张</Link>
            <Link href="/design/generate" className={buttonVariants({ variant: "ghost", size: "sm" })}>生成样张</Link>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => setDarkMode(!darkMode)}>
                  {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>主题切换</TooltipContent>
            </Tooltip>
            <a
              href="https://github.com/shadcn-ui/ui"
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <GitHubIcon className="mr-2 h-4 w-4" />
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl px-4 py-10">
        {/* Hero Section */}
        <section className="mb-16 text-center">
          <Badge variant="secondary" className="mb-4">
            <Zap className="mr-1 h-3 w-3" /> Next.js + Tailwind CSS + shadcn/ui
          </Badge>
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl">
             beautifully designed components
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            shadcn/ui 是一套基于 Radix UI 和 Tailwind CSS 的精美组件集合。
            它不是传统的组件库，而是可以直接复制粘贴使用的优质组件代码。
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button size="lg">
              开始使用
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button variant="outline" size="lg">
              <Copy className="mr-2 h-4 w-4" />
              复制代码
            </Button>
          </div>
        </section>

        {/* Features */}
        <section className="mb-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Palette, title: "主题化", desc: "基于 CSS 变量的主题系统，轻松切换明暗模式" },
            { icon: Code2, title: "可定制", desc: "源码即所得，每个组件都可以自由修改" },
            { icon: Layers, title: "组合式", desc: "基于 Radix UI 原语，保证无障碍可访问性" },
            { icon: Package, title: "零依赖", desc: "不引入额外运行时，复制即用" },
          ].map((f) => (
            <Card key={f.title}>
              <CardHeader>
                <f.icon className="h-8 w-8 text-primary mb-2" />
                <CardTitle className="text-base">{f.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>{f.desc}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </section>

        {/* Button Section */}
        <section className="mb-16">
          <SectionTitle description="按钮用于触发操作或提交表单">Button 按钮</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <ComponentCard title="变体 Variants">
              <div className="flex flex-wrap gap-2">
                <Button>Default</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="link">Link</Button>
                <Button variant="destructive">Destructive</Button>
              </div>
            </ComponentCard>
            <ComponentCard title="尺寸 Sizes">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="xs">XS</Button>
                <Button size="sm">Small</Button>
                <Button>Default</Button>
                <Button size="lg">Large</Button>
              </div>
            </ComponentCard>
            <ComponentCard title="带图标 With Icons">
              <div className="flex flex-wrap gap-2">
                <Button><Mail className="mr-2 h-4 w-4" />邮件</Button>
                <Button variant="outline"><Send className="mr-2 h-4 w-4" />发送</Button>
                <Button variant="secondary"><Heart className="mr-2 h-4 w-4" />收藏</Button>
              </div>
            </ComponentCard>
            <ComponentCard title="状态 States">
              <div className="flex flex-wrap gap-2">
                <Button disabled>禁用</Button>
                <Button variant="outline" disabled>禁用 Outline</Button>
                <Button>
                  <Spinner />
                  加载中...
                </Button>
              </div>
            </ComponentCard>
          </div>
        </section>

        {/* Input & Form Section */}
        <section className="mb-16">
          <SectionTitle description="表单相关组件：输入框、文本域、复选框、标签">Input & Form</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <ComponentCard title="输入框 Input">
              <div className="space-y-3">
                <Input placeholder="请输入用户名..." />
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="搜索..." className="pl-8" />
                </div>
                <Input disabled placeholder="已禁用" />
              </div>
            </ComponentCard>
            <ComponentCard title="文本域 Textarea">
              <Textarea placeholder="请输入您的反馈..." className="min-h-[100px]" />
            </ComponentCard>
            <ComponentCard title="复选框 Checkbox">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Checkbox id="c1" checked={checked} onCheckedChange={(v) => setChecked(!!v)} />
                  <Label htmlFor="c1">接受服务条款</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="c2" defaultChecked />
                  <Label htmlFor="c2">已选中</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="c3" disabled />
                  <Label htmlFor="c3">禁用</Label>
                </div>
              </div>
            </ComponentCard>
            <ComponentCard title="登录表单示例">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="email">邮箱</Label>
                  <Input id="email" type="email" placeholder="name@example.com" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">密码</Label>
                  <Input id="password" type="password" placeholder="输入密码..." />
                </div>
                <Button className="w-full">登录</Button>
              </div>
            </ComponentCard>
          </div>
        </section>

        {/* Data Display Section */}
        <section className="mb-16">
          <SectionTitle description="数据展示组件：卡片、徽章、头像、表格">Data Display</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <ComponentCard title="卡片 Card">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">项目概览</CardTitle>
                  <CardDescription>本月项目进度统计</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-2xl font-bold">1,234</p>
                      <p className="text-xs text-muted-foreground">总提交数</p>
                    </div>
                    <CheckCircle2 className="h-8 w-8 text-green-500" />
                  </div>
                </CardContent>
                <CardFooter className="text-xs text-muted-foreground">
                  较上月增长 12%
                </CardFooter>
              </Card>
            </ComponentCard>
            <ComponentCard title="徽章 Badge">
              <div className="flex flex-wrap gap-2">
                <Badge>Default</Badge>
                <Badge variant="secondary">Secondary</Badge>
                <Badge variant="outline">Outline</Badge>
                <Badge variant="destructive">Destructive</Badge>
                <Badge className="bg-blue-500">Blue</Badge>
                <Badge className="bg-green-500 text-white">Success</Badge>
              </div>
            </ComponentCard>
            <ComponentCard title="头像 Avatar">
              <div className="flex items-center gap-4">
                <Avatar className="h-12 w-12">
                  <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
                  <AvatarFallback>CN</AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium">@shadcn</p>
                  <p className="text-xs text-muted-foreground">shadcn/ui 作者</p>
                </div>
              </div>
            </ComponentCard>
            <ComponentCard title="表格 Table">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>组件</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">数量</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow><TableCell>Button</TableCell><TableCell><Badge variant="secondary">稳定</Badge></TableCell><TableCell className="text-right">6</TableCell></TableRow>
                  <TableRow><TableCell>Input</TableCell><TableCell><Badge variant="secondary">稳定</Badge></TableCell><TableCell className="text-right">3</TableCell></TableRow>
                  <TableRow><TableCell>Dialog</TableCell><TableCell><Badge variant="outline">开发中</Badge></TableCell><TableCell className="text-right">2</TableCell></TableRow>
                </TableBody>
              </Table>
            </ComponentCard>
          </div>
        </section>

        {/* Feedback Section */}
        <section className="mb-16">
          <SectionTitle description="反馈组件：提示、进度、骨架屏">Feedback</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <ComponentCard title="提示 Alert">
              <div className="space-y-3">
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>提示</AlertTitle>
                  <AlertDescription>这是一条普通提示信息。</AlertDescription>
                </Alert>
                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertTitle>错误</AlertTitle>
                  <AlertDescription>请检查输入内容后重试。</AlertDescription>
                </Alert>
              </div>
            </ComponentCard>
            <ComponentCard title="进度条 Progress">
              <div className="space-y-4">
                <Progress value={progress} />
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setProgress(Math.max(0, progress - 10))}>-10</Button>
                  <Button size="sm" variant="outline" onClick={() => setProgress(Math.min(100, progress + 10))}>+10</Button>
                  <span className="text-sm text-muted-foreground ml-auto">{progress}%</span>
                </div>
              </div>
            </ComponentCard>
            <ComponentCard title="骨架屏 Skeleton">
              <div className="flex items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              </div>
            </ComponentCard>
            <ComponentCard title="工具提示 Tooltip">
              <div className="flex flex-wrap gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Bell className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>通知中心</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Star className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>收藏项目</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Shield className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>安全设置</TooltipContent>
                </Tooltip>
              </div>
            </ComponentCard>
          </div>
        </section>

        {/* Interactive Section */}
        <section className="mb-16">
          <SectionTitle description="交互组件：开关、标签页、切换">Interactive</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <ComponentCard title="开关 Switch">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="airplane-mode">飞行模式</Label>
                  <Switch id="airplane-mode" checked={switchOn} onCheckedChange={setSwitchOn} />
                </div>
                <Separator />
                <p className="text-xs text-muted-foreground">
                  飞行模式已{switchOn ? "开启" : "关闭"}
                </p>
              </div>
            </ComponentCard>
            <ComponentCard title="切换 Toggle">
              <div className="space-y-3">
                <div className="flex gap-1">
                  <Toggle aria-label="Toggle bold" pressed={toggleBold} onPressedChange={setToggleBold}>
                    <Bold className="h-4 w-4" />
                  </Toggle>
                  <Toggle aria-label="Toggle italic" pressed={toggleItalic} onPressedChange={setToggleItalic}>
                    <Italic className="h-4 w-4" />
                  </Toggle>
                  <Toggle aria-label="Toggle underline" pressed={toggleUnderline} onPressedChange={setToggleUnderline}>
                    <UnderlineIcon className="h-4 w-4" />
                  </Toggle>
                </div>
                <p className="text-xs text-muted-foreground">
                  格式: {[toggleBold && "粗体", toggleItalic && "斜体", toggleUnderline && "下划线"].filter(Boolean).join(" + ") || "无"}
                </p>
              </div>
            </ComponentCard>
            <div className="sm:col-span-2">
              <ComponentCard title="标签页 Tabs">
                <Tabs defaultValue="overview" className="w-full">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="overview">概览</TabsTrigger>
                    <TabsTrigger value="analytics">分析</TabsTrigger>
                    <TabsTrigger value="reports">报告</TabsTrigger>
                  </TabsList>
                  <TabsContent value="overview">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">项目概览</CardTitle>
                        <CardDescription>查看项目的整体运行状况</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-3 gap-4">
                          <div className="text-center">
                            <p className="text-2xl font-bold">24</p>
                            <p className="text-xs text-muted-foreground">活跃任务</p>
                          </div>
                          <div className="text-center">
                            <p className="text-2xl font-bold">89%</p>
                            <p className="text-xs text-muted-foreground">完成率</p>
                          </div>
                          <div className="text-center">
                            <p className="text-2xl font-bold">5</p>
                            <p className="text-xs text-muted-foreground">团队成员</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>
                  <TabsContent value="analytics">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">数据分析</CardTitle>
                        <CardDescription>本月数据趋势分析</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {["周一", "周二", "周三", "周四", "周五"].map((day, i) => (
                            <div key={day} className="flex items-center gap-2">
                              <span className="text-xs w-8 text-muted-foreground">{day}</span>
                              <div className="flex-1">
                                <Progress value={[65, 45, 80, 55, 90][i]} className="h-2" />
                              </div>
                              <span className="text-xs w-8 text-right">{[65, 45, 80, 55, 90][i]}%</span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>
                  <TabsContent value="reports">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">报告中心</CardTitle>
                        <CardDescription>最近生成的报告列表</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>报告名称</TableHead>
                              <TableHead>日期</TableHead>
                              <TableHead className="text-right">状态</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            <TableRow>
                              <TableCell>月度总结</TableCell>
                              <TableCell>2026-07-01</TableCell>
                              <TableCell className="text-right"><Badge variant="secondary">已完成</Badge></TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell>性能分析</TableCell>
                              <TableCell>2026-06-28</TableCell>
                              <TableCell className="text-right"><Badge variant="secondary">已完成</Badge></TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell>安全审计</TableCell>
                              <TableCell>2026-06-25</TableCell>
                              <TableCell className="text-right"><Badge variant="outline">进行中</Badge></TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              </ComponentCard>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t pt-8 pb-16 text-center">
          <p className="text-sm text-muted-foreground">
            Built with <Heart className="inline h-3 w-3 text-red-500" /> using Next.js, Tailwind CSS & shadcn/ui
          </p>
          <div className="mt-4 flex items-center justify-center gap-4">
            <a
              href="https://ui.shadcn.com"
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >文档</a>
            <Separator orientation="vertical" className="h-4" />
            <a
              href="https://github.com/shadcn-ui/ui"
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >GitHub</a>
            <Separator orientation="vertical" className="h-4" />
            <a
              href="https://twitter.com/shadcn"
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >Twitter</a>
          </div>
        </footer>
      </main>
    </div>
  )
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
    </svg>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  )
}
