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
});

function buildCompactSystemPrompt(): string {
  return [
    'You are an illustration art director.',
    'Select 3 to 5 existing asset IDs from the provided catalog that best match the user metaphor or title.',
    'Assign each item:',
    '- layoutRole: "hero" (1 main focal item), "supporting" (1-3 secondary items), or "backdrop" (0-2 background decorative items).',
    '- appearance: "main" (colored foreground) or "background" (monochrome background).',
    'Rules:',
    '1. ONLY use assetId values that exist in the catalog.',
    '2. Do NOT invent new IDs, SVG code, or coordinates.',
    '3. Avoid duplicate assetId entries.',
    '4. Return valid JSON strictly matching: {"items":[{"assetId":"...","layoutRole":"hero|supporting|backdrop","appearance":"main|background"}]}',
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

  const { prompt, assets } = parsedRequest.data;
  const ollamaUrl = (
    process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'
  ).replace(/\/+$/, '');
  const ollamaModel = process.env.OLLAMA_MODEL || 'qwen2.5:7b';

  // Минималистичный формат каталога для экономии токенов (4-8k контекст)
  const compactCatalog = assets.map((a) => ({
    id: a.id,
    title: a.title,
    tags: a.tags.slice(0, 6),
    ...(a.category ? { category: a.category } : {}),
  }));

  const userMessage = `Catalog:\n${JSON.stringify(compactCatalog)}\n\nUser metaphor/title: "${prompt}"`;

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
          num_predict: 350,
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

  // Извлекаем JSON даже если модель обернула его в ```json ... ```
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

  // Программная очистка: оставляем только существующие assetId и убираем дубликаты
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

  // Гарантируем наличие хотя бы одного hero, если модель вернула только supporting
  if (!cleanItems.some((item) => item.layoutRole === 'hero')) {
    cleanItems[0].layoutRole = 'hero';
  }

  return NextResponse.json({
    model: ollamaModel,
    items: cleanItems,
  });
}
