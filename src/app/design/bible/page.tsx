import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buttonVariants } from "@/components/ui/button";

// T11 fixture 样张：数据固定（不查库），与 docs/specs/bible.md §2.2 的卡片语义一致。
// 覆盖全部徽章形态：待确认（confidence<0.7）、已校订、二创设定（origin=user）。

type FixtureEntry = {
  kind: string;
  name: string;
  data: Record<string, unknown>;
  anchors: { chapterSeq: number; quote: string }[];
  confidence: number;
  origin: "extracted" | "user";
  editedByUser: boolean;
};

const KIND_LABELS: Record<string, string> = {
  setting: "设定",
  character: "角色",
  relationship: "关系",
  plot_arc: "情节线",
  timeline_event: "时间线",
};

const FIXTURE_ENTRIES: FixtureEntry[] = [
  {
    kind: "setting",
    name: "花果山",
    data: { type: "地点", content: "东胜神洲傲来国海中名山，乃十洲之祖脉，三岛之来龙。" },
    anchors: [{ chapterSeq: 1, quote: "却说那花果山有一块仙石" }],
    confidence: 0.95,
    origin: "extracted",
    editedByUser: false,
  },
  {
    kind: "character",
    name: "孙悟空",
    data: {
      aliases: ["石猴", "美猴王", "齐天大圣"],
      personality: "桀骜不驯、机智果敢、重情重义",
      abilities: ["七十二变", "筋斗云", "金刚不坏"],
      speechPatternSamples: ["俺老孙来也！", "妖怪，吃我一棒！"],
      growthArc: "从石猴到斗战胜佛",
    },
    anchors: [{ chapterSeq: 1, quote: "化作一个石猴" }],
    confidence: 0.98,
    origin: "extracted",
    editedByUser: true,
  },
  {
    kind: "character",
    name: "六耳猕猴（二创）",
    data: {
      aliases: ["假悟空"],
      personality: "用户二创：与悟空亦敌亦友的镜像角色",
      abilities: ["随心铁杆兵"],
      speechPatternSamples: [],
      growthArc: "",
    },
    anchors: [],
    confidence: 1,
    origin: "user",
    editedByUser: false,
  },
  {
    kind: "relationship",
    name: "孙悟空 → 众猴",
    data: { source: "孙悟空", target: "花果山众猴", type: "君臣", evolution: "石猴称王，众猴拜伏" },
    anchors: [{ chapterSeq: 1, quote: "齐声称他为美猴王" }],
    confidence: 0.62,
    origin: "extracted",
    editedByUser: false,
  },
  {
    kind: "plot_arc",
    name: "石猴出世",
    data: { arcType: "main", summary: "花果山仙石迸裂，石猴出世，开启取经故事主线。", keyTurningPoints: [1] },
    anchors: [{ chapterSeq: 1, quote: "产一石卵" }],
    confidence: 0.9,
    origin: "extracted",
    editedByUser: false,
  },
  {
    kind: "timeline_event",
    name: "石猴发现水帘洞",
    data: { time: "出世后某日", event: "石猴纵身跃入瀑布，发现水帘洞，众猴拜其为王" },
    anchors: [{ chapterSeq: 1, quote: "直至瀑布之下" }],
    confidence: 0.55,
    origin: "extracted",
    editedByUser: false,
  },
];

function renderDataSummary(entry: FixtureEntry): string {
  const d = entry.data;
  switch (entry.kind) {
    case "character":
      return `性格 ${d.personality ?? ""}；能力 ${(d.abilities as string[]).join("、")}`;
    case "setting":
      return `${d.type ?? "设定"}：${d.content ?? ""}`;
    case "relationship":
      return `${d.source ?? ""} → ${d.target ?? ""}（${d.type ?? ""}）：${d.evolution ?? ""}`;
    case "plot_arc":
      return `${d.arcType === "main" ? "主线" : "支线"}：${d.summary ?? ""}`;
    case "timeline_event":
      return `${d.time ?? ""}：${d.event ?? ""}`;
    default:
      return "";
  }
}

function EntryCard({ entry }: { entry: FixtureEntry }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <CardTitle className="text-base">{entry.name}</CardTitle>
          <Badge variant="secondary">{KIND_LABELS[entry.kind] ?? entry.kind}</Badge>
          {entry.confidence < 0.7 && <Badge variant="destructive">待确认</Badge>}
          {entry.editedByUser && <Badge variant="outline">已校订</Badge>}
          {entry.origin === "user" && <Badge>二创设定</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{renderDataSummary(entry)}</p>
        <p className="text-xs text-muted-foreground">置信度：{entry.confidence.toFixed(2)}</p>
        {entry.anchors.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium">出处锚点</p>
            {entry.anchors.map((a, i) => (
              <p key={i} className="text-xs text-muted-foreground">
                第 {a.chapterSeq} 回：「{a.quote}」
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DesignBiblePage() {
  const kinds = Object.keys(KIND_LABELS);
  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">百科条目样张（fixture）</h1>
          <p className="text-sm text-muted-foreground">数据固定，覆盖全部徽章形态，供视觉验收</p>
        </div>
        <Link href="/design" className={buttonVariants({ variant: "outline", size: "sm" })}>
          返回组件展示
        </Link>
      </div>

      <Tabs defaultValue="character">
        <TabsList>
          {kinds.map((kind) => (
            <TabsTrigger key={kind} value={kind}>
              {KIND_LABELS[kind]}（{FIXTURE_ENTRIES.filter((e) => e.kind === kind).length}）
            </TabsTrigger>
          ))}
        </TabsList>
        {kinds.map((kind) => (
          <TabsContent key={kind} value={kind}>
            <div className="grid gap-4 sm:grid-cols-2">
              {FIXTURE_ENTRIES.filter((e) => e.kind === kind).map((e) => (
                <EntryCard key={e.name} entry={e} />
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
