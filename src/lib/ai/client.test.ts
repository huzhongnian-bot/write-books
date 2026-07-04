import { describe, it, expect } from "vitest";
import { callStructured } from "./client";
import { extractChapterResultSchema } from "@/lib/db/schema";

describe("AI client (MOCK_AI=1)", () => {
  it("returns a parseable extract-chapter structure", async () => {
    const result = await callStructured({
      model: "claude-opus-4-8",
      purpose: "extract-chapter",
      messages: [{ role: "user", content: "fixture chapter text" }],
      schema: extractChapterResultSchema,
    });

    expect(result.summary).toBeDefined();
    expect(Array.isArray(result.characters)).toBe(true);
    expect(Array.isArray(result.events)).toBe(true);
    expect(Array.isArray(result.settingClues)).toBe(true);
  });
});
