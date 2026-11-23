import {
  AiClientConfig,
  AppearanceState,
  Asset,
  LayoutRole,
} from '@/types';

export type LayoutPlacement =
  | 'center'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'on-top';

export interface AiSuggestedItem {
  assetId: string;
  layoutRole: LayoutRole;
  appearance: AppearanceState;
  placement?: LayoutPlacement;
}

export interface AiComposeResult {
  model: string;
  backdropAssetId: string | null;
  items: AiSuggestedItem[];
}

export async function generateCompositionByMetaphor(
  prompt: string,
  assets: Asset[],
  aiConfig?: AiClientConfig
): Promise<AiComposeResult> {
  const objectAssets = assets.filter((a) => a.category !== 'background');
  const backdrops = assets
    .filter((a) => a.category === 'background')
    .map((a) => ({ id: a.id, title: a.title }));

  const configPayload = aiConfig?.useCustomConfig
    ? {
        provider: aiConfig.provider,
        baseUrl: aiConfig.baseUrl,
        model: aiConfig.model,
        apiKey: aiConfig.apiKey,
        temperature: aiConfig.temperature,
      }
    : undefined;

  const res = await fetch('/api/compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      assets: objectAssets.map((a) => ({
        id: a.id,
        title: a.title,
        description: a.description,
        tags: a.tags,
        category: a.category,
      })),
      backdrops,
      config: configPayload,
    }),
  });

  const data = (await res.json()) as AiComposeResult & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка при генерации композиции через AI');
  }

  return data;
}