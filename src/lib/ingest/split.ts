import iconv from "iconv-lite";

export interface ChapterSplit {
  seq: number;
  title: string;
  content: string;
}

// 章节头（行首锚定，对 trim 后的整行测试）：「第X章/回/节/卷」为主；
// 「卷X」（无「第」字，如「卷一 金狮的荣耀」）是实体书/台版排版常见的
// 卷级标题，同样视作切分点
const CHAPTER_HEADER_REGEX = /^(?:第[一二三四五六七八九十百千万零\d]+[章节回卷]|卷[一二三四五六七八九十百千万零\d]+)/;

const SECTION_TITLE_MAX_CHARS = 20;

/**
 * 小节标题启发式：前后皆空行的短行（≤20 字），且不像正文——
 * 不以引号/破折号/书名号/星号开头（对话、标记线、RP 星号旁白），
 * 不以句读或星号结尾（叙述句、RP 旁白常以 *…* 包裹，如「*他挑了挑眉。*」）。
 * 用于没有「第X章」编号的实体书小节（如「巨蟹座·兰迪斯」场景题）。
 * 误伤面：诗歌单行/金句独立行可能被当作标题，只会多切、不会丢字，可接受。
 */
function isSectionTitle(lines: string[], i: number): boolean {
  const isBlank = (j: number) =>
    j < 0 || j >= lines.length || lines[j].trim() === "";
  if (!isBlank(i - 1) || !isBlank(i + 1)) return false;

  const t = lines[i].trim();
  if (t.length < 2 || t.length > SECTION_TITLE_MAX_CHARS) return false;
  if (/^[“「『《——*"']/.test(t)) return false;
  if (/[。，！？；：、…—”」』*"']$/.test(t)) return false;
  // 必须含至少一个文字字符：排除纯符号分隔线（如本书的 PUA 装饰符行、*** 等）
  if (!/[一-鿿A-Za-z0-9]/.test(t)) return false;
  return true;
}

/**
 * Split a raw Chinese novel text into chapters.
 *
 * Strategy:
 * 1. Chapter boundaries = lines that are 第X章/回/节/卷 or 卷X headers,
 *    plus unnumbered section titles detected by isSectionTitle.
 * 2. Slice the text between consecutive boundary lines.
 * 3. If no boundaries found, fall back to a single chapter.
 *    (Preamble before the first boundary, e.g. 书名页, is dropped.)
 */
export function splitChapters(text: string): ChapterSplit[] {
  // 剥离游离的 U+FEFF：UTF-16 导出的文件常在行首残留 BOM 字符，
  // String.trim() 不会移除它，残留的「不可见行」会被小节启发式误判为标题
  const normalized = text.replace(/\r\n/g, "\n").replace(/\uFEFF/g, "");
  const lines = normalized.split("\n");

  const boundaries: { offset: number; title: string }[] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (
      trimmed.length > 0 &&
      (CHAPTER_HEADER_REGEX.test(trimmed) || isSectionTitle(lines, i))
    ) {
      boundaries.push({ offset, title: trimmed });
    }
    offset += lines[i].length + 1; // +1 = 被 split 吃掉的 \n
  }

  if (boundaries.length === 0) {
    return [
      {
        seq: 1,
        title: "",
        content: normalized.trim(),
      },
    ];
  }

  return boundaries.map((boundary, i) => ({
    seq: i + 1,
    title: boundary.title,
    content: normalized
      .slice(boundary.offset, boundaries[i + 1]?.offset ?? normalized.length)
      .trim(),
  }));
}

/**
 * Decode an uploaded TXT buffer. Chinese web-novel TXT files are very often
 * GBK-encoded, so try strict UTF-8 first and fall back to GBK when the bytes
 * are not valid UTF-8. BOM takes precedence over everything: a UTF-16 file
 * mis-decoded as GBK turns into irrecoverable mojibake (real case: UTF-16LE
 * export from Windows 记事本).
 */
export function decodeText(buffer: Buffer): {
  text: string;
  encoding: "utf-8" | "gbk" | "utf-16le" | "utf-16be";
} {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(buffer), encoding: "utf-8" };
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(buffer), encoding: "utf-16le" };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(buffer), encoding: "utf-16be" };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return { text, encoding: "utf-8" };
  } catch {
    return { text: iconv.decode(buffer, "gbk"), encoding: "gbk" };
  }
}
