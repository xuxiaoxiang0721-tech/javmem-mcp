# 导出提示词 / Export prompt

把下面的提示词贴给你用过的 AI（Grok、Muse、Dot、ChatGPT 这类），它会把记得的、关于你的事写成一个 javmem 包。把它的回答整个存成一个文件，再用 `javmem-inherit check` 检查、`javmem-inherit import` 导入。这段文字和 `javmem-inherit prompt` 打印的一样。

Paste the prompt below into an AI you have used (Grok, Muse, Dot, ChatGPT and the like); it writes what it remembers about you as a javmem package. Save its whole answer as a file, then `javmem-inherit check` it and `javmem-inherit import` it. The text is what `javmem-inherit prompt --en` prints.

## 中文

```text
请把你记得的、关于我的所有事整理出来。我要把它搬进另一个记忆工具（javmem），以后在那边接着用。

要求：
1. 只写你确实记得、或者在我们以前的对话里出现过的内容，不要猜，不要编。拿不准的，在 "note" 里写明哪里拿不准。
2. 一条只写一件事，写成一句完整的话，人名、数字、日期都写全。比如写「小明的女儿小雨每周三下午上游泳课」，不要写「她周三上课」。
3. 想得起时间的，写进 "when"（2026-05-01、2026-05、2026 都行）；想不起来就不写。
4. 尽量覆盖：我是谁；家人、朋友、同事；工作和项目；健康；钱和资产；喜好和习惯；计划和约定；我让你记住的事；我们一起做过的重要讨论和结论。
5. 只输出下面这种格式的 JSON，前后不要加别的话。一次写不完就分几段，每段都是完整的 JSON，"part" 写第几段；我说「继续」，你再写下一段。

{
  "javmem_inherit": 1,
  "tool": "你的名字，比如 Grok",
  "exported_at": "今天的日期，格式 YYYY-MM-DD",
  "part": 1,
  "facts": [
    { "text": "一句完整的事实", "when": "2026-05", "topic": "家人", "note": "" }
  ],
  "conversations": [
    { "title": "一段重要对话的题目", "when": "2026-10-02", "summary": "这段对话说了什么、最后定了什么" }
  ]
}
```

## English

```text
Please gather everything you remember about me. I am moving it into another memory tool (javmem) and will keep using it there.

Rules:
1. Only what you really remember, or what came up in our past conversations. Do not guess and do not make anything up. Where you are unsure, say what is unsure in "note".
2. One thing per item, as one full sentence, with names, numbers and dates written out. Write "Alex's daughter Mia has swimming lessons on Wednesday afternoons", not "she has lessons on Wednesday".
3. Put a date in "when" when you remember it (2026-05-01, 2026-05 or 2026); otherwise leave it out.
4. Cover as much as you can: who I am; family, friends and colleagues; work and projects; health; money and assets; tastes and habits; plans and promises; things I asked you to remember; important discussions we had and what we decided.
5. Answer with JSON in exactly this form and nothing before or after it. If it does not fit in one answer, split it into parts, each a complete JSON with its "part" number; when I say "continue", write the next part.

{
  "javmem_inherit": 1,
  "tool": "your name, such as Grok",
  "exported_at": "today's date, YYYY-MM-DD",
  "part": 1,
  "facts": [
    { "text": "one full sentence", "when": "2026-05", "topic": "family", "note": "" }
  ],
  "conversations": [
    { "title": "the subject of an important conversation", "when": "2026-10-02", "summary": "what was said and what was decided" }
  ]
}
```
