import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

// T11 fixture 样张：生成工作台三栏布局（spec generate.md §2.3）的静态呈现，
// 数据固定不查库；流式打字与交互由真实页 /projects/[id]/write/[sceneId] 实现。

const SCENE = {
  title: "发现水帘洞",
  seq: 2,
  pov: "孙悟空",
  time: "石猴出世后某日",
  place: "花果山瀑布",
  beats: "众猴嬉戏，石猴纵身跃入瀑布，发现水帘洞。",
  characters: ["孙悟空"],
  foreshadows: ["花果山"],
};

const DRAFT = `众猴在山中嬉戏，不觉日已过午。那石猴忽见一股瀑布飞泉，声如奔雷，直下深潭。

"哪个有本事的，钻进去寻个源头出来，不伤身体者，我等即拜他为王。"众猴齐齐鼓掌，连呼三声。

石猴应声高叫："我进去！我进去！"他瞑目蹲身，将身一纵，径跳入瀑布泉中。忽睁睛抬头观看，那里边却无水无波，明明朗朗的一架桥梁。

他住了身，定了神，仔细再看，原来是座铁板桥。桥下之水，冲贯于石窍之间，倒挂流出去，遮闭了桥门。却又欠身上桥头，再走再看，却似有人家住处一般，真个好所在。`;

const VERSIONS = [
  { id: 3, label: "v3（当前稿）— 续写：补一段众猴反应", time: "2026-07-18 20:30" },
  { id: 2, label: "v2 — 改写：把结尾改得悬念一些", time: "2026-07-18 20:12" },
  { id: 1, label: "v1 — 按要点创作", time: "2026-07-18 19:58" },
];

export default function DesignGeneratePage() {
  return (
    <div className="container mx-auto max-w-7xl px-4 py-8 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">生成工作台样张（fixture）</h1>
          <p className="text-sm text-muted-foreground">三栏布局静态样张，数据固定；交互以真实页为准</p>
        </div>
        <Link href="/design" className={buttonVariants({ variant: "outline", size: "sm" })}>
          返回组件展示
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr_320px]">
        {/* 左栏：场景要点 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              场景 {SCENE.seq}：{SCENE.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">POV：</span>{SCENE.pov}</p>
            <p><span className="text-muted-foreground">时间：</span>{SCENE.time}</p>
            <p><span className="text-muted-foreground">地点：</span>{SCENE.place}</p>
            <p><span className="text-muted-foreground">情节要点：</span>{SCENE.beats}</p>
            <Separator />
            <div className="flex flex-wrap gap-1">
              {SCENE.characters.map((c) => <Badge key={c} variant="secondary">{c}</Badge>)}
              {SCENE.foreshadows.map((f) => <Badge key={f} variant="outline">伏笔：{f}</Badge>)}
            </div>
            <Button variant="ghost" size="sm" disabled>← 返回脚本页</Button>
          </CardContent>
        </Card>

        {/* 中栏：正文 */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">正文（当前稿）</CardTitle>
              <Badge variant="secondary">已生成 300 字</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="whitespace-pre-wrap leading-7 text-[15px]">{DRAFT}</div>
          </CardContent>
        </Card>

        {/* 右栏：指令输入 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">生成指令</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-1">
              <Badge>按指令生成</Badge>
              <Badge variant="outline">续写</Badge>
              <Badge variant="outline">改写</Badge>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="instruction">写作指令</Label>
              <Textarea id="instruction" placeholder="例：突出石猴的胆识与众猴的反应" className="min-h-[100px]" disabled />
            </div>
            <Button className="w-full" disabled>生成</Button>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium">版本链</p>
              {VERSIONS.map((v) => (
                <div key={v.id} className="rounded-md border p-2 text-xs">
                  <p>{v.label}</p>
                  <p className="text-muted-foreground">{v.time}</p>
                </div>
              ))}
              <Button variant="outline" size="sm" className="w-full" disabled>基于此稿重写</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
