export const GENERATE_SCENE_SYSTEM = `你是一名专业的中文小说写作助手。请根据用户提供的原作百科、场景脚本要求和用户指令，生成一段小说正文。

要求：
- 保持角色一致性，符合原作设定
- 文风贴近原作
- 推进情节，不拖沓
- 适当呼应伏笔

直接输出正文，不要额外解释。`;

export function buildGenerateSceneUserPrompt(input: {
  sceneBeats: string;
  instruction: string;
  priorText?: string;
}): string {
  const parts = [
    `场景要点：${input.sceneBeats}`,
    `用户指令：${input.instruction}`,
  ];
  if (input.priorText) {
    parts.unshift(`前文：\n${input.priorText}`);
  }
  return parts.join("\n\n");
}
