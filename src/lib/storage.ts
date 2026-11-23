import { createStore, get, set, del } from 'idb-keyval';
import { Asset, ColorScheme, CompositionDocument } from '@/types';
import { PRESET_COLOR_SCHEMES } from './colors';

const store =
  typeof window !== 'undefined'
    ? createStore('svg-composer-db', 'composer-store')
    : undefined;

const KEYS = {
  ASSETS: 'assets_library',
  CUSTOM_SCHEMES: 'custom_color_schemes',
  COMPOSITIONS: 'saved_compositions',
  ACTIVE_COMPOSITION_ID: 'active_composition_id',
} as const;

export async function saveAssetsToStorage(assets: Asset[]): Promise<void> {
  if (!store) return;
  await set(KEYS.ASSETS, assets, store);
}

export async function loadAssetsFromStorage(): Promise<Asset[] | null> {
  if (!store) return null;
  const data = await get<Asset[]>(KEYS.ASSETS, store);
  return data ?? null;
}

export async function clearAssetsStorage(): Promise<void> {
  if (!store) return;
  await del(KEYS.ASSETS, store);
}

export async function loadColorSchemesFromStorage(): Promise<ColorScheme[]> {
  if (!store) return [...PRESET_COLOR_SCHEMES];
  const custom = (await get<ColorScheme[]>(KEYS.CUSTOM_SCHEMES, store)) ?? [];
  return [...PRESET_COLOR_SCHEMES, ...custom];
}

export async function saveCustomColorSchemes(
  allSchemes: ColorScheme[]
): Promise<void> {
  if (!store) return;
  const customOnly = allSchemes.filter((s) => !s.isPreset);
  await set(KEYS.CUSTOM_SCHEMES, customOnly, store);
}

export async function loadCompositionsFromStorage(): Promise<
  CompositionDocument[]
> {
  if (!store) return [];
  return (await get<CompositionDocument[]>(KEYS.COMPOSITIONS, store)) ?? [];
}

export async function saveCompositionToStorage(
  doc: CompositionDocument
): Promise<void> {
  if (!store) return;
  const list = await loadCompositionsFromStorage();
  const idx = list.findIndex((item) => item.id === doc.id);
  const updated = { ...doc, updatedAt: Date.now() };
  if (idx >= 0) {
    list[idx] = updated;
  } else {
    list.unshift(updated);
  }
  await set(KEYS.COMPOSITIONS, list, store);
  await set(KEYS.ACTIVE_COMPOSITION_ID, doc.id, store);
}

export async function deleteCompositionFromStorage(id: string): Promise<void> {
  if (!store) return;
  const list = await loadCompositionsFromStorage();
  await set(
    KEYS.COMPOSITIONS,
    list.filter((item) => item.id !== id),
    store
  );
}

export async function getActiveCompositionId(): Promise<string | null> {
  if (!store) return null;
  return (await get<string>(KEYS.ACTIVE_COMPOSITION_ID, store)) ?? null;
}