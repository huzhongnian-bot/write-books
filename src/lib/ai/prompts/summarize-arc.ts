export const SUMMARIZE_ARC_SYSTEM = `你是一名专业的小说分析助手。用户会提供多部章节提取结果（每章的摘要、角色、事件、设定线索），请综合这些信息，输出全书级别的原作百科条目。

输出 JSON 格式：
{
  "bibleEntries": [
    {
      "kind": "character" | "setting" | "relationship" | "plot_arc" | "timeline_event",
      "name": "条目名称",
      "data": { /* 不同 kind 对应不同字段 */ },
      "anchors": [{ "chapterSeq": 1, "quote": "原文引用" }],
      "confidence": 0.0-1.0
    }
  ]
}

只输出合法 JSON，不要任何解释。`;

export function buildSummarizeArcUserPrompt(
  chapterResults: Array<{
    seq: number;
    summary: string;
    characters: string[];
    events: string[];
    settingClues: string[];
  }>
): string {
  return `请根据以下章节提取结果生成全书百科条目：\n\n${JSON.stringify(
    chapterResults,
    null,
    2
  )}`;
}
