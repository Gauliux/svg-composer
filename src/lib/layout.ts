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

interface BoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
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
  const scale = (minSide * 0.84) / maxLibraryRef;
  return Math.max(0.1, Math.round(scale * 10000) / 10000);
}

function generateInstanceId(index: number, assetId: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `inst_${assetId}_${index}_${Date.now()}`;
}

function computeIntersectionArea(a: BoxRect, b: BoxRect, padding = 0): number {
  const left = Math.max(a.x - a.width / 2 - padding, b.x - b.width / 2);
  const right = Math.min(a.x + a.width / 2 + padding, b.x + b.width / 2);
  const top = Math.max(a.y - a.height / 2 - padding, b.y - b.height / 2);
  const bottom = Math.min(a.y + a.height / 2 + padding, b.y + b.height / 2);

  if (right <= left || bottom <= top) return 0;
  return (right - left) * (bottom - top);
}

/**
 * Направленные векторы по 30° изометрии.
 */
const ISO_VECTORS: Record<
  Exclude<LayoutPlacement, 'center' | 'on-top'>,
  { dx: number; dy: number }
> = {
  'top-right': { dx: 0.866, dy: -0.5 },
  'bottom-left': { dx: -0.866, dy: 0.5 },
  'top-left': { dx: -0.866, dy: -0.5 },
  'bottom-right': { dx: 0.866, dy: 0.5 },
  left: { dx: -0.96, dy: 0.2 },
  right: { dx: 0.96, dy: -0.2 },
};

const CANDIDATE_DIRS: Array<Exclude<LayoutPlacement, 'center' | 'on-top'>> = [
  'top-left',
  'bottom-right',
  'top-right',
  'bottom-left',
  'left',
  'right',
];

/**
 * Вычисляет позицию центра объекта B рядом с объектом A по вектору (dx, dy)
 * так, чтобы их габариты не пересекались и имели точный зазор gap (если gap > 0).
 */
function placeAdjacentToBox(
  anchor: BoxRect,
  w: number,
  h: number,
  dir: { dx: number; dy: number },
  gap: number
): { x: number; y: number } {
  const reqX =
    ((anchor.width + w) / 2 + gap) / Math.max(Math.abs(dir.dx), 0.001);
  const reqY =
    ((anchor.height + h) / 2 + gap) / Math.max(Math.abs(dir.dy), 0.001);
  const dist = Math.min(reqX, reqY);

  return {
    x: anchor.x + dir.dx * dist,
    y: anchor.y + dir.dy * dist,
  };
}

/**
 * Детерминированный изометрический Layout Engine:
 * - Выборочное наложение: ТОЛЬКО при явном placement === 'on-top' или лёгкий нахлёст для background-подложки.
 * - По умолчанию все объекты стоят плотной изометрической группой с зазором без коллизий.
 * - Весь кластер центрируется на Artboard как единое целое.
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
  const margin = Math.max(24, Math.min(artW, artH) * 0.05);
  const usableW = Math.max(artW - margin * 2, 100);
  const usableH = Math.max(artH - margin * 2, 100);

  const scaleSourceAssets =
    options.allAssets && options.allAssets.length > 0
      ? options.allAssets
      : Array.from(assetsMap.values());
  const canonicalScale = getCanonicalLibraryScale(scaleSourceAssets, {
    width: artW,
    height: artH,
  });

  // Если пришли из прямого выбора (Сценарий 2) — самым крупным делаем фокусный якорь
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

  // Якорь сцены: главный герой, либо фоновый якорь, если все фоновые
  const anchorEntry =
    heroObjects[0] ?? backdropObjects[0] ?? supportingObjects[0];

  const anchorBox: BoxRect = {
    x: 0,
    y: 0,
    width: anchorEntry.size.width,
    height: anchorEntry.size.height,
  };

  interface DraftPlaced {
    entry: (typeof entries)[number];
    box: BoxRect;
    tier: number;
  }

  const drafts: DraftPlaced[] = [];
  const placedMainBoxes: BoxRect[] = [];

  const anchorTier =
    anchorEntry.appearance === 'background' || anchorEntry.layoutRole === 'backdrop'
      ? 1
      : 2;

  drafts.push({ entry: anchorEntry, box: anchorBox, tier: anchorTier });
  if (anchorTier >= 2) {
    placedMainBoxes.push(anchorBox);
  }

  const gapPx = Math.max(14, Math.min(artW, artH) * 0.02);

  // 1. Размещаем остальные объекты
  const remaining = [
    ...backdropObjects.filter((e) => e !== anchorEntry),
    ...heroObjects.filter((e) => e !== anchorEntry),
    ...supportingObjects.filter((e) => e !== anchorEntry),
  ];

  remaining.forEach((entry, idx) => {
    const { width: w, height: h } = entry.size;
    const isBgProp =
      entry.appearance === 'background' || entry.layoutRole === 'backdrop';
    const isSmallAccent =
      entry.asset.referenceSize < anchorEntry.asset.referenceSize * 0.65;

    // Случай А: AI явно запросил положить сверху на плоскую опору ("on-top")
    if (entry.placement === 'on-top') {
      const box: BoxRect = {
        x: anchorBox.x - anchorBox.width * 0.05,
        y: anchorBox.y - anchorBox.height * 0.06,
        width: w,
        height: h,
      };
      drafts.push({ entry, box, tier: 3 });
      return;
    }

    // Случай Б: Ставим рядом с якорем без коллизий (или с лёгким нахлёстом для background-объекта)
    const desiredGap = isBgProp
      ? -Math.min(anchorBox.width, w) * 0.12
      : gapPx;

    const preferredDir =
      entry.placement && entry.placement !== 'center'
        ? entry.placement
        : undefined;

    const orderedDirs = preferredDir
      ? [preferredDir, ...CANDIDATE_DIRS.filter((d) => d !== preferredDir)]
      : [
          ...CANDIDATE_DIRS.slice(idx % CANDIDATE_DIRS.length),
          ...CANDIDATE_DIRS.slice(0, idx % CANDIDATE_DIRS.length),
        ];

    let bestBox: BoxRect | null = null;
    let minCollision = Infinity;

    for (const dirKey of orderedDirs) {
      const vec = ISO_VECTORS[dirKey];
      let candidatePos = placeAdjacentToBox(anchorBox, w, h, vec, desiredGap);

      // Если объект всё ещё задевает уже стоящие главные объекты — отодвигаем чуть дальше
      let candidateBox: BoxRect = {
        x: candidatePos.x,
        y: candidatePos.y,
        width: w,
        height: h,
      };

      if (!isBgProp) {
        for (let step = 0; step < 3; step += 1) {
          const hit = placedMainBoxes.some(
            (b) => computeIntersectionArea(candidateBox, b, gapPx * 0.5) > 0
          );
          if (!hit) break;
          candidatePos = {
            x: candidatePos.x + vec.dx * (Math.min(w, h) * 0.35 + gapPx),
            y: candidatePos.y + vec.dy * (Math.min(w, h) * 0.35 + gapPx),
          };
          candidateBox = { x: candidatePos.x, y: candidatePos.y, width: w, height: h };
        }
      }

      const collisionArea = isBgProp
        ? 0
        : placedMainBoxes.reduce(
            (sum, b) => sum + computeIntersectionArea(candidateBox, b, 4),
            0
          );

      // Бонус за соответствие соотношению сторон Artboard (для широкого холста предпочитаем горизонталь)
      const isHorizontalMove = Math.abs(vec.dx) > Math.abs(vec.dy);
      const aspectPenalty =
        artW > artH * 1.15 && !isHorizontalMove
          ? 500
          : artH > artW * 1.15 && isHorizontalMove
            ? 500
            : 0;

      const score = collisionArea + aspectPenalty;
      if (score < minCollision) {
        minCollision = score;
        bestBox = candidateBox;
        if (collisionArea === 0 && aspectPenalty === 0) {
          break;
        }
      }
    }

    const finalBox = bestBox ?? { x: 0, y: 0, width: w, height: h };
    const tier = isBgProp ? 1 : isSmallAccent ? 3 : 2;

    drafts.push({ entry, box: finalBox, tier });
    if (!isBgProp) {
      placedMainBoxes.push(finalBox);
    }
  });

  // 2. Считаем общий габарит всей собранной группы и вписываем её в центр Artboard
  const minX = Math.min(...drafts.map((d) => d.box.x - d.box.width / 2));
  const maxX = Math.max(...drafts.map((d) => d.box.x + d.box.width / 2));
  const minY = Math.min(...drafts.map((d) => d.box.y - d.box.height / 2));
  const maxY = Math.max(...drafts.map((d) => d.box.y + d.box.height / 2));

  const clusterW = Math.max(maxX - minX, 1);
  const clusterH = Math.max(maxY - minY, 1);
  const clusterCenterX = (minX + maxX) / 2;
  const clusterCenterY = (minY + maxY) / 2;

  // Если группа целиком шире или выше Artboard — сжимаем её всю целиком равномерным fitK
  const fitK = Math.min(usableW / clusterW, usableH / clusterH, 1);
  const finalScale = Math.max(
    0.1,
    Math.round(canonicalScale * fitK * 10000) / 10000
  );

  // 3. Сортируем слои и переводим в координаты Artboard
  const positioned = drafts.map((d, idx) => {
    const x =
      artW / 2 + (d.box.x - clusterCenterX) * fitK;
    const y =
      artH / 2 + (d.box.y - clusterCenterY) * fitK;

    return {
      instanceId: generateInstanceId(idx, d.entry.assetId),
      assetId: d.entry.assetId,
      appearance: d.entry.appearance,
      layoutRole: d.entry.layoutRole,
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      scale: finalScale,
      rotation: 0,
      zIndex: 0,
      _tier: d.tier,
      _area: d.box.width * d.box.height,
    };
  });

  positioned.sort((a, b) => {
    if (a._tier !== b._tier) return a._tier - b._tier;
    return b._area - a._area;
  });

  return positioned.map(({ _tier: _, _area: __, ...item }, index) => ({
    ...item,
    zIndex: index,
  }));
}