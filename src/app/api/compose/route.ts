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
  config: z
    .object({
      provider: z.enum(['ollama', 'openai']),
      baseUrl: z.string().trim().optional(),
      model: z.string().trim().optional(),
      apiKey: z.string().trim().optional(),
      temperature: z.number().min(0).max(1.5).optional(),
    })
    .optional(),
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

async function callOllama(
  baseUrl: string,
  model: string,
  temperature: number,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const cleanUrl = baseUrl.replace(/\/+$/, '');
  const res = await fetch(`${cleanUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: 'json',
      options: {
        temperature,
        num_predict: 400,
      },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const details = await res.text().catch(() => '');
    throw new Error(
      `Ollama вернула ошибку ${res.status} (модель "${model}"). ${details.slice(0, 150)}`
    );
  }

  const data = (await res.json()) as { message?: { content?: string } };
  const content = data?.message?.content?.trim();
  if (!content) throw new Error('Ollama вернула пустой ответ');
  return content;
}

async function callOpenAiCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  temperature: number,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const endpoint = cleanBase.endsWith('/chat/completions')
    ? cleanBase
    : `${cleanBase}/chat/completions`;

  const makeRequest = (useJsonMode: boolean) =>
    fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: 450,
        ...(useJsonMode ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });

  let res = await makeRequest(true);
  // Некоторые OpenAI-совместимые модели не поддерживают response_format: json_object
  if (res.status === 400) {
    const errText = await res.clone().text().catch(() => '');
    if (/response_format|json_object/i.test(errText)) {
      res = await makeRequest(false);
    }
  }

  if (!res.ok) {
    const details = await res.text().catch(() => '');
    throw new Error(
      `API вернуло ошибку ${res.status} (${model}). ${details.slice(0, 180)}`
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('API вернуло пустой ответ');
  return content;
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

  const { prompt, assets, backdrops, config } = parsedRequest.data;

  const envProvider =
    process.env.AI_PROVIDER === 'openai' ? 'openai' : 'ollama';
  const provider = config?.provider ?? envProvider;
  const temperature = config?.temperature ?? 0.2;

  const model =
    config?.model ||
    (provider === 'openai'
      ? process.env.AI_MODEL || 'gpt-4o-mini'
      : process.env.OLLAMA_MODEL || 'qwen2.5:7b');

  const baseUrl =
    config?.baseUrl ||
    (provider === 'openai'
      ? process.env.AI_BASE_URL || 'https://api.openai.com/v1'
      : process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434');

  const apiKey =
    config?.apiKey ||
    process.env.AI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    '';

  if (provider === 'openai' && !apiKey) {
    return NextResponse.json(
      {
        error:
          'Не указан API-ключ. Введите его в настройках AI (шестерёнка) или задайте AI_API_KEY в .env.local.',
      },
      { status: 401 }
    );
  }

  const compactCatalog = assets.map((a) => ({
    id: a.id,
    title: a.title,
    tags: a.tags.slice(0, 6),
    ...(a.category ? { category: a.category } : {}),
  }));

  const backdropPart =
    backdrops.length > 0 ? `\nBackdrops:\n${JSON.stringify(backdrops)}` : '';
  const userMessage = `Catalog:\n${JSON.stringify(compactCatalog)}${backdropPart}\n\nUser metaphor/title: "${prompt}"`;
  const systemPrompt = buildCompactSystemPrompt();

  let rawContent: string;
  try {
    rawContent =
      provider === 'openai'
        ? await callOpenAiCompatible(
            baseUrl,
            apiKey,
            model,
            temperature,
            systemPrompt,
            userMessage
          )
        : await callOllama(baseUrl, model, temperature, systemPrompt, userMessage);
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    const message = isTimeout
      ? 'Превышено время ожидания ответа от LLM (30 сек)'
      : err instanceof Error
        ? err.message
        : `Не удалось подключиться к ${provider} (${baseUrl})`;
    return NextResponse.json({ error: message }, { status: 503 });
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
      { error: 'AI не смогла подобрать подходящие компоненты из текущей библиотеки' },
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
    model: `${provider}:${model}`,
    backdropAssetId: cleanBackdropId,
    items: cleanItems,
  });
}