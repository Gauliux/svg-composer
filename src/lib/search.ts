import Fuse from 'fuse.js';
import { Asset } from '@/types';

export function createAssetSearchIndex(assets: Asset[]): Fuse<Asset> {
  return new Fuse(assets, {
    keys: [
      { name: 'title', weight: 0.45 },
      { name: 'tags', weight: 0.35 },
      { name: 'description', weight: 0.15 },
      { name: 'category', weight: 0.05 },
    ],
    threshold: 0.38,
    ignoreLocation: true,
    includeScore: true,
  });
}

export function searchAssets(
  assets: Asset[],
  query: string,
  category?: string
): Asset[] {
  const filteredByCategory =
    category && category !== 'all'
      ? assets.filter((a) => a.category === category)
      : assets;

  const trimmed = query.trim();
  if (!trimmed) {
    return filteredByCategory;
  }

  const index = createAssetSearchIndex(filteredByCategory);
  return index.search(trimmed).map((res) => res.item);
}

export function extractCategories(assets: Asset[]): string[] {
  const set = new Set<string>();
  for (const asset of assets) {
    if (asset.category) {
      set.add(asset.category);
    }
  }
  return Array.from(set).sort();
}