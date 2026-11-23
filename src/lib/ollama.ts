import { AppearanceState, Asset, LayoutRole } from '@/types';

export interface AiSuggestedItem {
  assetId: string;
  layoutRole: LayoutRole;
  appearance: AppearanceState;
}

export interface AiComposeResult {
  model: string;
  items: AiSuggestedItem[];
}

export async function generateCompositionByMetaphor(
  prompt: string,
  assets: Asset[]
): Promise<AiComposeResult> {
  const res = await fetch('/api/compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      assets: assets.map((a) => ({
        id: a.id,
        title: a.title,
        description: a.description,
        tags: a.tags,
        category: a.category,
      })),
    }),
  });

  const data = (await res.json()) as AiComposeResult & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка при генерации композиции через AI');
  }

  return data;
}