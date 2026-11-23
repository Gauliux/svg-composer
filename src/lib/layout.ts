import {
  AppearanceState,
  Asset,
  CanvasItem,
  DetailProfile,
  LayoutRole,
} from '@/types';

export interface LayoutInputItem {
  assetId: string;
  layoutRole?: LayoutRole;
  appearance?: AppearanceState;
}

export interface LayoutOptions {
  artboard: {
    width: number;
    height: number;
  };
  detailProfile: DetailProfile;
}

interface PlacedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Orientation = 'landscape' | 'portrait' | 'square';

interface AnchorPoint {
  /** Нормализованная координата X центра (0..1) */
  nx: number;
  /** Нормализованная координата Y центра (0..1) */
  ny: number;
  /** Лёгкий декоративный наклон в градусах для живости сцены (для hero = 0) */
  rotation: number;
}

function getOrientation(width: number, height: number): Orientation {
  const ratio = width / height;
  if (ratio > 1.15) return 'landscape';
  if (ratio < 0.87) return 'portrait';
  return 'square';
}

const SUPPORTING_ANCHORS: Record<Orientation, AnchorPoint[]> = {
  landscape: [
    { nx: 0.22, ny: 0.52, rotation: -4 },
    { nx: 0.78, ny: 0.48, rotation: 4 },
    { nx: 0.28, ny: 0.28, rotation: -6 },
    { nx: 0.72, ny: 0.72, rotation: 6 },
    { nx: 0.26, ny: 0.74, rotation: 3 },
    { nx: 0.74, ny: 0.26, rotation: -3 },
  ],
  portrait: [
    { nx: 0.5, ny: 0.22, rotation: -3 },
    { nx: 0.5, ny: 0.78, rotation: 3 },
    { nx: 0.26, ny: 0.3, rotation: -5 },
    { nx: 0.74, ny: 0.7, rotation: 5 },
    { nx: 0.74, ny: 0.28, rotation: 4 },
    { nx: 0.26, ny: 0.72, rotation: -4 },
  ],
  square: [
    { nx: 0.24, ny: 0.3, rotation: -4 },
    { nx: 0.76, ny: 0.7, rotation: 4 },
    { nx: 0.76, ny: 0.28, rotation: 5 },
    { nx: 0.24, ny: 0.72, rotation: -5 },
    { nx: 0.5, ny: 0.2, rotation: 0 },
    { nx: 0.5, ny: 0.8, rotation: 0 },
  ],
};

const BACKDROP_ANCHORS: Record<Orientation, AnchorPoint[]> = {
  landscape: [
    { nx: 0.16, ny: 0.22, rotation: -8 },
    { nx: 0.84, ny: 0.78, rotation: 8 },
    { nx: 0.84, ny: 0.22, rotation: 6 },
    { nx: 0.16, ny: 0.78, rotation: -6 },
  ],
  portrait: [
    { nx: 0.2, ny: 0.16, rotation: -7 },
    { nx: 0.8, ny: 0.84, rotation: 7 },
    { nx: 0.8, ny: 0.16, rotation: 5 },
    { nx: 0.2, ny: 0.84, rotation: -5 },
  ],
  square: [
    { nx: 0.18, ny: 0.18, rotation: -8 },
    { nx: 0.82, ny: 0.82, rotation: 8 },
    { nx: 0.82, ny: 0.18, rotation: 6 },
    { nx: 0.18, ny: 0.82, rotation: -6 },
  ],
};

function computeIntersectionArea(a: PlacedRect, b: PlacedRect): number {
  const left = Math.max(a.x - a.width / 2, b.x - b.width / 2);
  const right = Math.min(a.x + a.width / 2, b.x + b.width / 2);
  const top = Math.max(a.y - a.height / 2, b.y - b.height / 2);
  const bottom = Math.min(a.y + a.height / 2, b.y + b.height / 2);

  if (right <= left || bottom <= top) return 0;
  return (right - left) * (bottom - top);
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

  const clampedX =
    minX <= maxX ? Math.min(Math.max(cx, minX), maxX) : artW / 2;
  const clampedY =
    minY <= maxY ? Math.min(Math.max(cy, minY), maxY) : artH / 2;

  return {
    x: Math.round(clampedX * 100) / 100,
    y: Math.round(clampedY * 100) / 100,
  };
}

/**
 * Рассчитывает логические размеры объекта при заданном логическом scale,
 * с учётом нормализации referenceSize (сохраняя авторские пропорции объектов).
 */
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

function generateInstanceId(index: number, assetId: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `inst_${assetId}_${index}_${Date.now()}`;
}

/**
 * Детерминированный Layout Engine.
 * Гарантирует:
 * 1. Неизменность относительных пропорций объектов (единый sceneScale).
 * 2. Воспроизводимость раскладки при одинаковых входных данных.
 * 3. Корректное вписывание в границы Artboard и минимизацию перекрытий главных объектов.
 */
export function buildDeterministicLayout(
  inputItems: LayoutInputItem[],
  assetsMap: Map<string, Asset>,
  options: LayoutOptions
): CanvasItem[] {
  const validItems = inputItems.filter((item) => assetsMap.has(item.assetId));
  if (validItems.length === 0) return [];

  const { width: artW, height: artH } = options.artboard;
  const orientation = getOrientation(artW, artH);
  const margin = Math.max(24, Math.min(artW, artH) * 0.05);
  const usableW = artW - margin * 2;
  const usableH = artH - margin * 2;

  // Нормализуем роли, если элементы пришли из прямого выбора (Сценарий 2) без ролей
  const hasExplicitHero = validItems.some(
    (i) => i.layoutRole === 'hero' && assetsMap.get(i.assetId)?.category !== 'background'
  );
  let assignedHero = false;

  const normalized = validItems.map((item) => {
    const asset = assetsMap.get(item.assetId)!;
    const isCanvasBackdrop = asset.category === 'background';

    const appearance: AppearanceState = isCanvasBackdrop
      ? 'background'
      : (item.appearance ?? 'main');

    let layoutRole: LayoutRole = isCanvasBackdrop
      ? 'backdrop'
      : (item.layoutRole ?? 'supporting');

    if (!isCanvasBackdrop && !hasExplicitHero && !assignedHero) {
      layoutRole = 'hero';
      assignedHero = true;
    }

    return {
      assetId: item.assetId,
      appearance,
      layoutRole,
      isCanvasBackdrop,
      asset,
    };
  });

  // Вычисляем единый sceneScale только по предметным объектам (игнорируя полноразмерные фоны)
  const foregroundAndProps = normalized.filter((n) => !n.isCanvasBackdrop);
  const maxRef = Math.max(
    ...foregroundAndProps.map((n) => n.asset.referenceSize),
    1
  );
  const targetHeroFraction = foregroundAndProps.length <= 1 ? 0.62 : 0.46;
  let sceneScale =
    (Math.min(usableW, usableH) * targetHeroFraction) / maxRef;

  // Проверяем, чтобы ни один предметный объект не превысил 72% полезной области холста
  for (const entry of foregroundAndProps) {
    const sizeAtOne = getVisualSize(
      entry.asset,
      options.detailProfile,
      entry.appearance,
      1
    );
    const maxFitScale = Math.min(
      (usableW * 0.72) / Math.max(sizeAtOne.width, 1),
      (usableH * 0.72) / Math.max(sizeAtOne.height, 1)
    );
    sceneScale = Math.min(sceneScale, maxFitScale);
  }

  sceneScale = Math.max(0.1, Math.round(sceneScale * 10000) / 10000);

  // Разделяем по композиционным слоям: canvasBackdrop (0) -> backdrop -> supporting -> hero
  const canvasBackdropEntries = normalized.filter((i) => i.isCanvasBackdrop);
  const backdropEntries = normalized.filter(
    (i) => !i.isCanvasBackdrop && i.layoutRole === 'backdrop'
  );
  const supportingEntries = normalized.filter(
    (i) => !i.isCanvasBackdrop && i.layoutRole === 'supporting'
  );
  const heroEntries = normalized.filter(
    (i) => !i.isCanvasBackdrop && i.layoutRole === 'hero'
  );

  const placedForegroundRects: PlacedRect[] = [];
  const results: Array<CanvasItem & { _sortWeight: number }> = [];

  // 0. Размещаем полноразмерные декоративные фоны (B01 и т.п.) в центр под всей сценой
  canvasBackdropEntries.forEach((entry, idx) => {
    const coverScale =
      Math.round(
        (Math.max(artW, artH) / Math.max(entry.asset.referenceSize, 1)) * 10000
      ) / 10000;

    results.push({
      instanceId: generateInstanceId(results.length, entry.assetId),
      assetId: entry.assetId,
      appearance: 'background',
      layoutRole: 'backdrop',
      x: Math.round((artW / 2) * 100) / 100,
      y: Math.round((artH / 2) * 100) / 100,
      scale: coverScale,
      rotation: 0,
      zIndex: 0,
      _sortWeight: idx,
    });
  });

  // 1. Размещаем Hero
  heroEntries.forEach((entry, idx) => {
    const size = getVisualSize(
      entry.asset,
      options.detailProfile,
      entry.appearance,
      sceneScale
    );
    const offsetX = idx === 0 ? 0 : (idx % 2 === 0 ? 1 : -1) * size.width * 0.35;
    const rawX = artW * 0.5 + offsetX;
    const rawY = artH * 0.5;
    const pos = clampCenterToArtboard(
      rawX,
      rawY,
      size.width,
      size.height,
      artW,
      artH,
      margin
    );

    placedForegroundRects.push({
      x: pos.x,
      y: pos.y,
      width: size.width,
      height: size.height,
    });

    results.push({
      instanceId: generateInstanceId(results.length, entry.assetId),
      assetId: entry.assetId,
      appearance: entry.appearance,
      layoutRole: 'hero',
      x: pos.x,
      y: pos.y,
      scale: sceneScale,
      rotation: 0,
      zIndex: 0,
      _sortWeight: 300 + idx,
    });
  });

  // 2. Размещаем Supporting с выбором опорной точки с минимальным пересечением
  const supAnchors = SUPPORTING_ANCHORS[orientation];
  const usedSupIndices = new Set<number>();

  supportingEntries.forEach((entry, idx) => {
    const size = getVisualSize(
      entry.asset,
      options.detailProfile,
      entry.appearance,
      sceneScale
    );

    let bestAnchor = supAnchors[idx % supAnchors.length];
    let bestPos = clampCenterToArtboard(
      artW * bestAnchor.nx,
      artH * bestAnchor.ny,
      size.width,
      size.height,
      artW,
      artH,
      margin
    );
    let minCollision = Infinity;
    let chosenIdx = idx % supAnchors.length;

    supAnchors.forEach((anchor, aIdx) => {
      if (usedSupIndices.has(aIdx) && usedSupIndices.size < supAnchors.length) {
        return;
      }
      const candidatePos = clampCenterToArtboard(
        artW * anchor.nx,
        artH * anchor.ny,
        size.width,
        size.height,
        artW,
        artH,
        margin
      );
      const candidateRect: PlacedRect = {
        x: candidatePos.x,
        y: candidatePos.y,
        width: size.width,
        height: size.height,
      };
      const collision = placedForegroundRects.reduce(
        (sum, r) => sum + computeIntersectionArea(candidateRect, r),
        0
      );

      if (collision < minCollision) {
        minCollision = collision;
        bestAnchor = anchor;
        bestPos = candidatePos;
        chosenIdx = aIdx;
      }
    });

    usedSupIndices.add(chosenIdx);
    placedForegroundRects.push({
      x: bestPos.x,
      y: bestPos.y,
      width: size.width,
      height: size.height,
    });

    results.push({
      instanceId: generateInstanceId(results.length, entry.assetId),
      assetId: entry.assetId,
      appearance: entry.appearance,
      layoutRole: 'supporting',
      x: bestPos.x,
      y: bestPos.y,
      scale: sceneScale,
      rotation: bestAnchor.rotation,
      zIndex: 0,
      _sortWeight: 200 + idx,
    });
  });

  // 3. Размещаем Backdrop (обычные объекты на заднем плане)
  const bgAnchors = BACKDROP_ANCHORS[orientation];
  backdropEntries.forEach((entry, idx) => {
    const anchor = bgAnchors[idx % bgAnchors.length];
    const size = getVisualSize(
      entry.asset,
      options.detailProfile,
      entry.appearance,
      sceneScale
    );
    const pos = clampCenterToArtboard(
      artW * anchor.nx,
      artH * anchor.ny,
      size.width,
      size.height,
      artW,
      artH,
      margin
    );

    results.push({
      instanceId: generateInstanceId(results.length, entry.assetId),
      assetId: entry.assetId,
      appearance: entry.appearance,
      layoutRole: 'backdrop',
      x: pos.x,
      y: pos.y,
      scale: sceneScale,
      rotation: anchor.rotation,
      zIndex: 0,
      _sortWeight: 100 + idx,
    });
  });

  // Назначаем итоговый детерминированный zIndex (снизу вверх: canvasBackdrop -> backdrop -> supporting -> hero)
  results.sort((a, b) => a._sortWeight - b._sortWeight);
  return results.map(({ _sortWeight: _, ...item }, index) => ({
    ...item,
    zIndex: index,
  }));
}