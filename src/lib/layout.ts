import {
  AppearanceState,
  Asset,
  CanvasItem,
  DetailProfile,
  LayoutRole,
} from '@/types';
import { LayoutPlacement } from './ollama';

export interface LayoutInputItem {
  assetId: string;
  layoutRole?: LayoutRole;
  appearance?: AppearanceState;
  placement?: LayoutPlacement;
}

export interface LayoutOptions {
  artboard: {
    width: number;
    height: number;
  };
  detailProfile: DetailProfile;
  /** Полный список ассетов библиотеки для расчёта единого канонического масштаба */
  allAssets?: Asset[];
}

function getVisualSize(
  asset: Asset,
  detailProfile: DetailProfile,
  appearance: AppearanceState,
  logicalScale: number
): { width: number; height: number } {
  const variant = asset.variants[detailProfile][appearance];
  const variantMax = Math.max(variant.bounds.width, variant.bounds.height) || 1;
  const norm = asset.referenceSize / variantMax;
  return {
    width: variant.bounds.width * norm * logicalScale,
    height: variant.bounds.height * norm * logicalScale,
  };
}

/**
 * Единый канонический масштаб для всей библиотеки на текущем Artboard.
 * Используется и при ручном добавлении через "+", и при автосборке сцены —
 * гарантирует неизменность пропорций объектов относительно друг друга.
 */
export function getCanonicalLibraryScale(
  assets: Asset[],
  artboard: { width: number; height: number }
): number {
  const objectAssets = assets.filter((a) => a.category !== 'background');
  const maxLibraryRef = Math.max(
    ...objectAssets.map((a) => a.referenceSize),
    1
  );
  const minSide = Math.min(artboard.width, artboard.height);
  // На холсте 1000x1000 и книге 1446px даёт ~0.58 (визуально совпадает с эталонами из Figma)
  const scale = (minSide * 0.84) / maxLibraryRef;
  return Math.max(0.1, Math.round(scale * 10000) / 10000);
}

function clampCenterToArtboard(
  cx: number,
  cy: number,
  objW: number,
  objH: number,
  artW: number,
  artH: number,
  margin: number
): { x: number; y: number } {
  const minX = margin + objW / 2;
  const maxX = artW - margin - objW / 2;
  const minY = margin + objH / 2;
  const maxY = artH - margin - objH / 2;

  const x = minX <= maxX ? Math.min(Math.max(cx, minX), maxX) : artW / 2;
  const y = minY <= maxY ? Math.min(Math.max(cy, minY), maxY) : artH / 2;

  return {
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
  };
}

function generateInstanceId(index: number, assetId: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `inst_${assetId}_${index}_${Date.now()}`;
}

/**
 * Направленные векторы по 30° изометрической сетке (cos 30° ≈ 0.866, sin 30° = 0.5).
 */
const ISO_VECTORS: Record<
  Exclude<LayoutPlacement, 'center' | 'on-top'>,
  { dx: number; dy: number }
> = {
  'top-right': { dx: 0.866, dy: -0.5 },
  'bottom-left': { dx: -0.866, dy: 0.5 },
  'top-left': { dx: -0.866, dy: -0.5 },
  'bottom-right': { dx: 0.866, dy: 0.5 },
  left: { dx: -0.95, dy: 0.15 },
  right: { dx: 0.95, dy: -0.15 },
};

const DEFAULT_ISO_SEQUENCE: Array<Exclude<LayoutPlacement, 'center' | 'on-top'>> = [
  'top-left',
  'bottom-right',
  'top-right',
  'bottom-left',
  'left',
  'right',
];

/**
 * Детерминированный изометрический Layout Engine:
 * - Нулевой поворот (сохраняет 30° изометрию).
 * - Единый канонический масштаб (пропорции объектов относительно друг друга не меняются).
 * - Плотное кластерное размещение с опорой на реальные габариты объектов.
 * - Сортировка слоёв с учётом размера и роли (мелкие объекты не тонут под крупными).
 */
export function buildDeterministicLayout(
  inputItems: LayoutInputItem[],
  assetsMap: Map<string, Asset>,
  options: LayoutOptions
): CanvasItem[] {
  const validItems = inputItems.filter((item) => {
    const a = assetsMap.get(item.assetId);
    return a && a.category !== 'background';
  });
  if (validItems.length === 0) return [];

  const { width: artW, height: artH } = options.artboard;
  const margin = Math.max(20, Math.min(artW, artH) * 0.04);

  const scaleSourceAssets =
    options.allAssets && options.allAssets.length > 0
      ? options.allAssets
      : Array.from(assetsMap.values());
  const canonicalScale = getCanonicalLibraryScale(scaleSourceAssets, {
    width: artW,
    height: artH,
  });

  // Если пришло из прямого выбора (Сценарий 2) — самым крупным делаем главный или фоновый якорь
  const hasExplicitHero = validItems.some((i) => i.layoutRole === 'hero');
  const sortedBySizeForFallback = [...validItems].sort((a, b) => {
    const sizeA = assetsMap.get(a.assetId)!.referenceSize;
    const sizeB = assetsMap.get(b.assetId)!.referenceSize;
    return sizeB - sizeA;
  });
  const fallbackHeroId = sortedBySizeForFallback[0].assetId;

  const entries = validItems.map((item) => {
    const asset = assetsMap.get(item.assetId)!;
    const appearance: AppearanceState = item.appearance ?? 'main';
    let layoutRole: LayoutRole = item.layoutRole ?? 'supporting';
    if (!hasExplicitHero && item.assetId === fallbackHeroId) {
      layoutRole = 'hero';
    }
    const size = getVisualSize(
      asset,
      options.detailProfile,
      appearance,
      canonicalScale
    );
    return {
      assetId: item.assetId,
      asset,
      appearance,
      layoutRole,
      placement: item.placement,
      size,
    };
  });

  const backdropObjects = entries.filter(
    (e) => e.layoutRole === 'backdrop' || e.appearance === 'background'
  );
  const heroObjects = entries.filter(
    (e) =>
      e.layoutRole === 'hero' &&
      e.appearance !== 'background' &&
      !backdropObjects.includes(e)
  );
  const supportingObjects = entries.filter(
    (e) => !backdropObjects.includes(e) && !heroObjects.includes(e)
  );

  // Если все объекты оказались фоновыми — главный фокус на самый крупный
  const anchorEntry =
    heroObjects[0] ?? backdropObjects[0] ?? supportingObjects[0];

  const placed: Array<CanvasItem & { _area: number; _layerTier: number }> = [];

  const anchorCenter = clampCenterToArtboard(
    artW * 0.5,
    artH * 0.52,
    anchorEntry.size.width,
    anchorEntry.size.height,
    artW,
    artH,
    margin
  );

  let usedSlotIndex = 0;

  const placeItem = (
    entry: (typeof entries)[number],
    isAnchor: boolean,
    tier: number
  ) => {
    const { width: w, height: h } = entry.size;
    let targetX = anchorCenter.x;
    let targetY = anchorCenter.y;

    if (!isAnchor) {
      const placement = entry.placement;

      // Маленький объект можно положить прямо на крупный якорь ("on-top")
      const isMuchSmallerThanAnchor =
        entry.asset.referenceSize < anchorEntry.asset.referenceSize * 0.58;

      if (
        placement === 'on-top' ||
        (!placement &&
          entry.layoutRole === 'supporting' &&
          anchorEntry.appearance === 'background' &&
          isMuchSmallerThanAnchor)
      ) {
        targetX = anchorCenter.x - anchorEntry.size.width * 0.06;
        targetY = anchorCenter.y - anchorEntry.size.height * 0.08;
      } else {
        const dirKey =
          placement && placement !== 'center' && placement !== 'on-top'
            ? placement
            : DEFAULT_ISO_SEQUENCE[usedSlotIndex % DEFAULT_ISO_SEQUENCE.length];
        usedSlotIndex += 1;

        const vec = ISO_VECTORS[dirKey];
        // Дистанция от центра якоря: плотный кластер с небольшим перекрытием или зазором
        const distX = (anchorEntry.size.width + w) * 0.34;
        const distY = (anchorEntry.size.height + h) * 0.34;

        // Для фоновых объектов (тулья/блокнот сзади) делаем дистанцию чуть меньше — лёгкий нахлёст
        const proximity =
          entry.appearance === 'background' || entry.layoutRole === 'backdrop'
            ? 0.78
            : 0.92;

        targetX = anchorCenter.x + vec.dx * distX * proximity;
        targetY = anchorCenter.y + vec.dy * distY * proximity;
      }
    }

    const pos = clampCenterToArtboard(
      targetX,
      targetY,
      w,
      h,
      artW,
      artH,
      margin
    );

    placed.push({
      instanceId: generateInstanceId(placed.length, entry.assetId),
      assetId: entry.assetId,
      appearance: entry.appearance,
      layoutRole: entry.layoutRole,
      x: pos.x,
      y: pos.y,
      scale: canonicalScale,
      rotation: 0, // Сохраняем строгую изометрическую перспективу без наклона
      zIndex: 0,
      _area: w * h,
      _layerTier: tier,
    });
  };

  // 1. Размещаем якорь (tier зависит от того, фон это или герой)
  placeItem(
    anchorEntry,
    true,
    anchorEntry.appearance === 'background' || anchorEntry.layoutRole === 'backdrop'
      ? 1
      : 2
  );

  // 2. Размещаем остальные фоновые объекты (нижний слой)
  for (const bg of backdropObjects) {
    if (bg === anchorEntry) continue;
    placeItem(bg, false, 1);
  }

  // 3. Размещаем остальных героев (если вдруг >1) и вспомогательные объекты
  for (const h of heroObjects) {
    if (h === anchorEntry) continue;
    placeItem(h, false, 2);
  }
  for (const s of supportingObjects) {
    if (s === anchorEntry) continue;
    // Очень маленькие предметы (замок, ручка, пазлы) поднимаем выше по z-index, чтобы не тонули за книгой
    const isSmallAccent =
      s.asset.referenceSize < anchorEntry.asset.referenceSize * 0.65;
    placeItem(s, false, isSmallAccent ? 3 : 2);
  }

  // Сортируем слои: сначала нижний tier (backdrop/background), внутри одного tier — крупные сзади, мелкие спереди
  placed.sort((a, b) => {
    if (a._layerTier !== b._layerTier) {
      return a._layerTier - b._layerTier;
    }
    return b._area - a._area;
  });

  return placed.map(({ _area: _, _layerTier: __, ...item }, index) => ({
    ...item,
    zIndex: index,
  }));
}