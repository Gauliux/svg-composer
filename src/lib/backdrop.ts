import { FabricObject, loadSVGFromString } from 'fabric';
import {
  Asset,
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

interface TokenizedBackdropObj extends FabricObject {
  __isBackdrop?: boolean;
  __fillToken?: ColorToken;
  __strokeToken?: ColorToken;
}

type Corner = 'TL' | 'TR' | 'BL' | 'BR';

function stripDefsAndWrapperGroups(svgString: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const root = doc.documentElement;

  // Убираем <defs>, т.к. обрезку выполняет сам Artboard viewBox
  root.querySelectorAll('defs').forEach((d) => d.remove());

  // Разворачиваем <g> без transform (например, <g clip-path="url(#...)">)
  const groups = Array.from(root.querySelectorAll('g'));
  for (const g of groups) {
    if (!g.getAttribute('transform') && g.parentNode) {
      while (g.firstChild) {
        g.parentNode.insertBefore(g.firstChild, g);
      }
      g.remove();
    }
  }

  return new XMLSerializer().serializeToString(root);
}

/**
 * Создаёт массив заблокированных векторных объектов декоративного фона,
 * элементы которого автоматически привязаны к углам Artboard любого формата.
 */
export async function createAdaptiveBackdropObjects(
  asset: Asset,
  detailProfile: DetailProfile,
  scheme: ColorScheme,
  artboard: { width: number; height: number }
): Promise<TokenizedBackdropObj[]> {
  const variant = asset.variants[detailProfile].background;
  const fillBindings = new Map<number, ColorToken>();
  const strokeBindings = new Map<number, ColorToken>();

  for (const b of variant.colorBindings) {
    if (b.target === 'stroke') strokeBindings.set(b.pathIndex, b.token);
    else fillBindings.set(b.pathIndex, b.token);
  }

  const cleanSvg = stripDefsAndWrapperGroups(variant.svg);
  const rootHasFillNone = /<svg[^>]*\bfill=["']none["']/i.test(cleanSvg);
  const sourceW = variant.bounds.width || 1000;
  const sourceH = variant.bounds.height || 1000;

  let shapeCounter = 0;
  const skippedIndices = new Set<number>();

  const { objects } = await loadSVGFromString(cleanSvg, (svgEl, fabricObj) => {
    const tag = svgEl.tagName.toLowerCase();
    if (!SHAPE_TAGS.has(tag)) return;

    const currentIdx = shapeCounter;
    shapeCounter += 1;

    // Пропускаем полноразмерный прямоугольник заливки (его роль выполняет doc.backgroundFill)
    if (tag === 'rect') {
      const rw = parseFloat(svgEl.getAttribute('width') || '0');
      const rh = parseFloat(svgEl.getAttribute('height') || '0');
      if (rw >= sourceW * 0.9 && rh >= sourceH * 0.9) {
        skippedIndices.add(currentIdx);
        return;
      }
    }

    const meta = fabricObj as TokenizedBackdropObj;
    const fToken = fillBindings.get(currentIdx);
    const sToken = strokeBindings.get(currentIdx);
    if (fToken) meta.__fillToken = fToken;
    if (sToken) meta.__strokeToken = sToken;

    const rawFill = svgEl.getAttribute('fill');
    if (rawFill === 'none' || (!rawFill && rootHasFillNone)) {
      fabricObj.set({ fill: '' });
    }
  });

  // Вычисляем масштаб угловых деталей по меньшей стороне Artboard
  const cornerScale = Math.min(artboard.width, artboard.height) / sourceW;

  const result: TokenizedBackdropObj[] = [];
  let loadedIdx = 0;

  for (const rawObj of objects) {
    if (!rawObj) {
      loadedIdx += 1;
      continue;
    }
    if (skippedIndices.has(loadedIdx)) {
      loadedIdx += 1;
      continue;
    }
    loadedIdx += 1;

    const obj = rawObj as TokenizedBackdropObj;
    const center = obj.getCenterPoint();

    // Определяем квадрант исходного квадрата
    const isRight = center.x >= sourceW / 2;
    const isBottom = center.y >= sourceH / 2;
    const corner: Corner = isBottom
      ? isRight
        ? 'BR'
        : 'BL'
      : isRight
        ? 'TR'
        : 'TL';

    // Позиционируем центр детали относительно соответствующего угла нового Artboard
    const offsetFromLeft = center.x * cornerScale;
    const offsetFromRight = (sourceW - center.x) * cornerScale;
    const offsetFromTop = center.y * cornerScale;
    const offsetFromBottom = (sourceH - center.y) * cornerScale;

    const targetX =
      corner === 'TR' || corner === 'BR'
        ? artboard.width - offsetFromRight
        : offsetFromLeft;
    const targetY =
      corner === 'BL' || corner === 'BR'
        ? artboard.height - offsetFromBottom
        : offsetFromTop;

    obj.set({
      originX: 'center',
      originY: 'center',
      left: targetX,
      top: targetY,
      scaleX: (obj.scaleX ?? 1) * cornerScale,
      scaleY: (obj.scaleY ?? 1) * cornerScale,
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      hoverCursor: 'default',
    });

    if (obj.__fillToken) {
      obj.set({
        fill: resolveColorFromScheme(scheme, obj.__fillToken, 'background'),
      });
    }
    if (obj.__strokeToken) {
      obj.set({
        stroke: resolveColorFromScheme(scheme, obj.__strokeToken, 'background'),
      });
    }

    obj.__isBackdrop = true;
    obj.setCoords();
    result.push(obj);
  }

  return result;
}

export function recolorBackdropObjects(
  objects: FabricObject[],
  scheme: ColorScheme
): void {
  for (const raw of objects) {
    const obj = raw as TokenizedBackdropObj;
    if (!obj.__isBackdrop) continue;
    if (obj.__fillToken) {
      obj.set({
        fill: resolveColorFromScheme(scheme, obj.__fillToken, 'background'),
      });
    }
    if (obj.__strokeToken) {
      obj.set({
        stroke: resolveColorFromScheme(scheme, obj.__strokeToken, 'background'),
      });
    }
    obj.dirty = true;
  }
}