export interface ChapterSplit {
  seq: number;
  title: string;
  content: string;
}

const CHAPTER_HEADER_REGEX = /(?:^|\n)\s*第[一二三四五六七八九十百千万零\d]+[章节回卷]\s*[^\n]*\n/g;

/**
 * Split a raw Chinese novel text into chapters.
 *
 * Strategy:
 * 1. Look for lines that start with "第X章/回/节/卷" as chapter headers.
 * 2. Use matchAll to find all headers, then slice the text between them.
 * 3. If no headers found, fall back to a single chapter.
 */
export function splitChapters(text: string): ChapterSplit[] {
  const normalized = text.replace(/\r\n/g, "\n");

  const matches = Array.from(normalized.matchAll(CHAPTER_HEADER_REGEX));
  if (matches.length === 0) {
    return [
      {
        seq: 1,
        title: "",
        content: normalized.trim(),
      },
    ];
  }

  const chapters: ChapterSplit[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const start = match.index ?? 0;
    const nextStart = matches[i + 1]?.index ?? normalized.length;
    const content = normalized.slice(start, nextStart).trim();
    const title = match[0].trim();

    chapters.push({
      seq: i + 1,
      title,
      content,
    });
  }

  return chapters;
}

export function detectEncoding(_buffer: Buffer): "utf-8" | "gbk" {
  // P0 only supports UTF-8; GBK detection can be added later with iconv-lite
  return "utf-8";
}
