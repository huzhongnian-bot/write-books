import type { StructuredRequest, StreamingRequest, AiMessage } from "../client";
import fs from "node:fs";
import path from "node:path";

const RECORDINGS_DIR = path.resolve("fixtures/recordings");

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findRecording(purpose: string): unknown | null {
  if (!fs.existsSync(RECORDINGS_DIR)) return null;

  const files = fs.readdirSync(RECORDINGS_DIR);
  const match = files.find((f) => f.startsWith(purpose) && f.endsWith(".json"));
  if (!match) return null;

  const raw = fs.readFileSync(path.join(RECORDINGS_DIR, match), "utf-8");
  return JSON.parse(raw);
}

export const mockClient = {
  async callStructured<T>(req: StructuredRequest<T>): Promise<T> {
    const recording = findRecording(req.purpose);
    if (recording) {
      return req.schema.parse(recording);
    }

    // Default mock responses by purpose
    if (req.purpose === "extract-chapter") {
      return req.schema.parse({
        summary: "本章为 fixture 占位摘要。",
        characters: ["孙悟空"],
        events: ["石猴出世"],
        settingClues: ["花果山"],
      });
    }

    if (req.purpose === "summarize-arc") {
      return req.schema.parse({
        bibleEntries: [
          {
            kind: "character",
            name: "孙悟空",
            data: {
              aliases: ["石猴"],
              personality: "机智果敢",
              abilities: ["七十二变"],
              speechPatternSamples: [],
            },
            anchors: [{ chapterSeq: 1, quote: "化作一个石猴" }],
            confidence: 0.9,
          },
        ],
      });
    }

    throw new Error(`No mock recording for purpose: ${req.purpose}`);
  },

  async* callStreaming(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _req: StreamingRequest
  ): AsyncGenerator<string, { draftContent: string; usage: unknown }, void> {
    const text =
      "却说那石猴睁开双眼，目运两道金光，射冲斗府。众猴见之，皆拜伏在地，齐声称他为美猴王。";
    const chunkSize = 4;

    for (let i = 0; i < text.length; i += chunkSize) {
      yield text.slice(i, i + chunkSize);
      await sleep(30);
    }

    return {
      draftContent: text,
      usage: {
        input_tokens: 1000,
        output_tokens: 50,
        cache_read_input_tokens: 900,
      },
    };
  },

  // Exported for tests that need to assert on message shape
  messages: {} as Record<string, AiMessage[]>,
};
