import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { aiCompositionResponseSchema } from '@/lib/validation';

const requestBodySchema = z.object({
  prompt: z.string().trim().min(2).max(500),
  assets: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        description: z.string().optional(),
        tags: z.array(z.string()).default([]),
        category: z.string().optional(),
      })
    )
    .min(1),
  backdrops: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
      })
    )
    .optional()
    .default([]),
});

function buildCompactSystemPrompt(): string {
  return [
    'You are an isometric illustration art director.',
    'Select 2 to 4 existing asset IDs from Catalog that form a cohesive scene matching the user metaphor.',
    'Assign each item:',
    '- layoutRole: "hero" (1 main focal item), "supporting" (1-2 secondary items), or "backdrop" (0-1 background object placed behind hero).',
    '- appearance: "main" (colored foreground) or "background" (monochrome object behind main items).',
    '- placement: "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right" | "left" | "right" | "on-top".',
    'Placement rules:',
    '1. Use "on-top" ONLY when a smaller item physically rests on a flat surface (e.g. pen, puzzles, or smartphone resting on an open book or notebook).',
    '2. For standalone objects like lamp, vase, headphones, or wallet, NEVER use "on-top" — place them side-by-side using "top-left", "bottom-right", "left", "right", etc.',
    '3. ONLY use assetId values from Catalog and backdropAssetId from Backdrops (or null).',
    '4. Avoid duplicate assetId entries.',
    '5. Return valid JSON strictly matching: {"backdropAssetId":"...|null","items":[{"assetId":"...","layoutRole":"hero|supporting|backdrop","appearance":"main|background","placement":"center|top-left|top-right|bottom-left|bottom-right|left|right|on-top"}]}',
  ].join('\n');
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Некорректное тело запроса (ожидается JSON)' },
      { status: 400 }
    );
  }

  const parsedRequest = requestBodySchema.safeParse(body);
  if (!parsedRequest.success) {
    return NextResponse.json(
      { error: 'Укажите текст метафоры и непустой каталог компонентов' },
      { status: 400 }
    );
  }

  const { prompt, assets, backdrops } = parsedRequest.data;
  const ollamaUrl = (
    process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'
  ).replace(/\/+$/, '');
  const ollamaModel = process.env.OLLAMA_MODEL || 'qwen2.5:7b';

  const compactCatalog = assets.map((a) => ({
    id: a.id,
    title: a.title,
    tags: a.tags.slice(0, 6),
    ...(a.category ? { category: a.category } : {}),
  }));

  const backdropPart =
    backdrops.length > 0 ? `\nBackdrops:\n${JSON.stringify(backdrops)}` : '';
  const userMessage = `Catalog:\n${JSON.stringify(compactCatalog)}${backdropPart}\n\nUser metaphor/title: "${prompt}"`;

  let ollamaRes: Response;
  try {
    ollamaRes = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        stream: false,
        format: 'json',
        options: {
          temperature: 0.2,
          num_predict: 380,
        },
        messages: [
          { role: 'system', content: buildCompactSystemPrompt() },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'TimeoutError'
        ? 'Превышено время ожидания ответа от Ollama (30 сек)'
        : `Не удалось подключиться к локальной Ollama (${ollamaUrl}). Убедитесь, что сервис Ollama запущен.`;
    return NextResponse.json({ error: message }, { status: 503 });
  }

  if (!ollamaRes.ok) {
    const details = await ollamaRes.text().catch(() => '');
    return NextResponse.json(
      {
        error: `Ollama вернула ошибку ${ollamaRes.status}. Проверьте, загружена ли модель "${ollamaModel}".`,
        details,
      },
      { status: 502 }
    );
  }

  const ollamaJson = (await ollamaRes.json()) as {
    message?: { content?: string };
  };
  const rawContent = ollamaJson?.message?.content?.trim();

  if (!rawContent) {
    return NextResponse.json(
      { error: 'Ollama вернула пустой ответ' },
      { status: 502 }
    );
  }

  const jsonText = rawContent
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsedAiJson: unknown;
  try {
    parsedAiJson = JSON.parse(jsonText);
  } catch {
    return NextResponse.json(
      { error: 'AI вернула некорректный JSON. Попробуйте переформулировать запрос.' },
      { status: 502 }
    );
  }

  const validated = aiCompositionResponseSchema.safeParse(parsedAiJson);
  if (!validated.success) {
    return NextResponse.json(
      { error: 'Структура ответа AI не соответствует ожидаемой схеме' },
      { status: 502 }
    );
  }

  const validIds = new Set(assets.map((a) => a.id));
  const seen = new Set<string>();
  const cleanItems = validated.data.items.filter((item) => {
    if (!validIds.has(item.assetId) || seen.has(item.assetId)) {
      return false;
    }
    seen.add(item.assetId);
    return true;
  });

  if (cleanItems.length === 0) {
    return NextResponse.json(
      {
        error:
          'AI не смогла подобрать подходящие компоненты из текущей библиотеки',
      },
      { status: 422 }
    );
  }

  if (!cleanItems.some((item) => item.layoutRole === 'hero')) {
    cleanItems[0].layoutRole = 'hero';
  }

  const validBackdropIds = new Set(backdrops.map((b) => b.id));
  const rawBackdropId = validated.data.backdropAssetId;
  const cleanBackdropId =
    rawBackdropId && validBackdropIds.has(rawBackdropId) ? rawBackdropId : null;

  return NextResponse.json({
    model: ollamaModel,
    backdropAssetId: cleanBackdropId,
    items: cleanItems,
  });
}