import {
  Canvas,
  FabricObject,
  Group,
  loadSVGFromString,
  util,
} from 'fabric';
import {
  AppearanceState,
  Asset,
  AssetVariant,
  CanvasItem,
  ColorScheme,
  ColorToken,
  DetailProfile,
} from '@/types';
import { resolveColorFromScheme } from './colors';

const SHAPE_TAGS = new Set([
  'path',
  'rect',
  'circle',
  'ellipse',
  'polygon',
  'polyline',
  'line',
]);

export interface FabricComposerObject extends Group {
  __instanceId?: string;
  __assetId?: string;
  __appearance?: AppearanceState;
  __normalizationFactor?: number;
}

interface TokenizedChild {
  __colorToken?: ColorToken;
}

/**
 * Вычисляет коэффициент нормализации для приведения S/L к единому логическому размеру.
 */
export function getNormalizationFactor(
  asset: Asset,
  variant: AssetVariant
): number {
  const variantMax = Math.max(variant.bounds.width, variant.bounds.height);
  if (variantMax <= 0) return 1;
  return asset.referenceSize / variantMax;
}

/**
 * Применяет цветовую схему к каждому примитиву внутри объекта Fabric по сохранённым токенам.
 */
export function applyColorSchemeToFabricObject(
  obj: FabricObject,
  scheme: ColorScheme,
  appearance: AppearanceState
): void {
  if (obj instanceof Group) {
    for (const child of obj.getObjects()) {
      applyColorSchemeToFabricObject(child, scheme, appearance);
    }
    obj.dirty = true;
    return;
  }

  const token = (obj as FabricObject & TokenizedChild).__colorToken;
  if (token) {
    const newFill = resolveColorFromScheme(scheme, token, appearance);
    obj.set({ fill: newFill });
    obj.dirty = true;
  }
}

/**
 * Загружает нужный вариант SVG в Fabric Group, привязывает токены и настраивает ограничения.
 */
export async function createFabricGroupFromItem(
  item: CanvasItem,
  asset: Asset,
  detailProfile: DetailProfile,
  scheme: ColorScheme
): Promise<FabricComposerObject> {
  const variant = asset.variants[detailProfile][item.appearance];
  const bindingsMap = new Map<number, ColorToken>();
  for (const b of variant.colorBindings) {
    bindingsMap.set(b.pathIndex, b.token);
  }

  let shapeCounter = 0;

  const { objects, options } = await loadSVGFromString(
    variant.svg,
    (svgElement, fabricObj) => {
      const tag = svgElement.tagName.toLowerCase();
      if (SHAPE_TAGS.has(tag)) {
        const token = bindingsMap.get(shapeCounter);
        if (token) {
          (fabricObj as FabricObject & TokenizedChild).__colorToken = token;
        }
        shapeCounter += 1;
      }
    }
  );

  const validObjects = objects.filter((o): o is FabricObject => o !== null);
  const grouped = util.groupSVGElements(validObjects, options);

  // Гарантируем, что любой компонент на холсте представлен единой неделимой группой
  const group: FabricComposerObject =
    grouped instanceof Group
      ? (grouped as FabricComposerObject)
      : (new Group([grouped]) as FabricComposerObject);

  const normFactor = getNormalizationFactor(asset, variant);
  const fabricScale = item.scale * normFactor;

  group.set({
    originX: 'center',
    originY: 'center',
    left: item.x,
    top: item.y,
    angle: item.rotation,
    scaleX: fabricScale,
    scaleY: fabricScale,
    lockScalingFlip: true,
    centeredRotation: true,
  });

  // Запрещаем непропорциональное масштабирование (скрываем боковые ручки)
  group.setControlsVisibility({
    mt: false,
    mb: false,
    ml: false,
    mr: false,
  });

  group.__instanceId = item.instanceId;
  group.__assetId = item.assetId;
  group.__appearance = item.appearance;
  group.__normalizationFactor = normFactor;

  applyColorSchemeToFabricObject(group, scheme, item.appearance);
  group.setCoords();

  return group;
}

/**
 * Перекрашивает все объекты активной сцены Fabric при смене цветовой схемы.
 */
export function recolorCanvas(canvas: Canvas, scheme: ColorScheme): void {
  for (const obj of canvas.getObjects()) {
    const composerObj = obj as FabricComposerObject;
    const appearance: AppearanceState = composerObj.__appearance ?? 'main';
    applyColorSchemeToFabricObject(composerObj, scheme, appearance);
  }
  canvas.requestRenderAll();
}

/**
 * Извлекает актуальные параметры CanvasItem из объекта Fabric после ручного редактирования.
 */
export function extractTransformFromFabricObject(
  obj: FabricComposerObject
): Pick<CanvasItem, 'x' | 'y' | 'scale' | 'rotation'> {
  const norm = obj.__normalizationFactor || 1;
  const rawScale = obj.scaleX ?? 1;
  return {
    x: Math.round((obj.left ?? 0) * 100) / 100,
    y: Math.round((obj.top ?? 0) * 100) / 100,
    scale: Math.round((rawScale / norm) * 10000) / 10000,
    rotation: Math.round((((obj.angle ?? 0) % 360) + 360) % 360 * 100) / 100,
  };
}

/**
 * Экспортирует текущую сцену Fabric в чистый векторный SVG по точным размерам Artboard.
 */
export function exportCanvasToSvg(
  canvas: Canvas,
  artboard: { width: number; height: number }
): string {
  const prevVpt = [...canvas.viewportTransform] as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const prevWidth = canvas.getWidth();
  const prevHeight = canvas.getHeight();
  const prevSelection = canvas.getActiveObject();

  try {
    canvas.discardActiveObject();
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    canvas.setDimensions({
      width: artboard.width,
      height: artboard.height,
    });

    return canvas.toSVG({
      width: String(artboard.width),
      height: String(artboard.height),
      viewBox: {
        x: 0,
        y: 0,
        width: artboard.width,
        height: artboard.height,
      },
    });
  } finally {
    canvas.setViewportTransform(prevVpt);
    canvas.setDimensions({
      width: prevWidth,
      height: prevHeight,
    });
    if (prevSelection) {
      canvas.setActiveObject(prevSelection);
    }
    canvas.requestRenderAll();
  }
}