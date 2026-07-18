import iconv from "iconv-lite";

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

/**
 * Decode an uploaded TXT buffer. Chinese web-novel TXT files are very often
 * GBK-encoded, so try strict UTF-8 first and fall back to GBK when the bytes
 * are not valid UTF-8.
 */
export function decodeText(buffer: Buffer): {
  text: string;
  encoding: "utf-8" | "gbk";
} {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return { text, encoding: "utf-8" };
  } catch {
    return { text: iconv.decode(buffer, "gbk"), encoding: "gbk" };
  }
}
