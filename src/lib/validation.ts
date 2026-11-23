import { z } from 'zod';
import {
  ALL_COLOR_TOKENS,
  AppearanceState,
  BoundingBox,
  ColorToken,
  PathColorBinding,
} from '@/types';
import { resolveTokenForSourceColor, isTokenAllowedForAppearance, normalizeColor } from './colors';

const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Ожидается цвет в формате #RRGGBB');

export const colorSchemeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  isPreset: z.boolean().optional(),
  background: z.object({
    BG_1: hexColorSchema,
    BG_2: hexColorSchema,
    BG_3: hexColorSchema,
    BG_4: hexColorSchema,
  }),
  objects: z.object({
    OBJ_1: hexColorSchema,
    OBJ_2: hexColorSchema,
    OBJ_3: hexColorSchema,
    OBJ_4: hexColorSchema,
  }),
});

export const manifestSchema = z.object({
  profiles: z.tuple([z.literal('S'), z.literal('L')]).optional(),
  appearances: z.tuple([z.literal('main'), z.literal('background')]).optional(),
  colorMapping: z
    .record(z.string(), z.enum(ALL_COLOR_TOKENS))
    .optional(),
  assets: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        description: z.string().default(''),
        tags: z.array(z.string()).default([]),
        category: z.string().optional(),
        variants: z.object({
          S: z.object({
            main: z.string().min(1),
            background: z.string().min(1),
          }),
          L: z.object({
            main: z.string().min(1),
            background: z.string().min(1),
          }),
        }),
      })
    )
    .min(1),
});

export const aiCompositionResponseSchema = z.object({
  backdropAssetId: z.string().nullable().optional(),
  items: z
    .array(
      z.object({
        assetId: z.string().min(1),
        layoutRole: z.enum(['hero', 'supporting', 'backdrop']),
        appearance: z.enum(['main', 'background']),
      })
    )
    .min(1)
    .max(8),
});

const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'clippath',
  'path',
  'rect',
  'circle',
  'ellipse',
  'polygon',
  'polyline',
  'line',
]);

const ALLOWED_ATTRS = new Set([
  'xmlns',
  'id',
  'width',
  'height',
  'viewbox',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'clip-path',
  'd',
  'x',
  'y',
  'rx',
  'ry',
  'cx',
  'cy',
  'r',
  'x1',
  'y1',
  'x2',
  'y2',
  'points',
  'transform',
  'fill-rule',
  'clip-rule',
  'data-token',
]);

export interface ParsedSvgResult {
  width: number;
  height: number;
  viewBox: string;
  bounds: BoundingBox;
  colorBindings: PathColorBinding[];
  pathCount: number;
  unknownColors: string[];
  disallowedTokens: ColorToken[];
}

function parseNumericAttr(value: string | null): number | null {
  if (!value) return null;
  const num = parseFloat(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function parseViewBox(viewBoxStr: string | null): BoundingBox | null {
  if (!viewBoxStr) return null;
  const parts = viewBoxStr
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return null;
  }
  const [x, y, width, height] = parts;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/**
 * Парсит и строго валидирует SVG-строку (работает в браузере через DOMParser).
 */
export function parseAndValidateSvg(
  svgString: string,
  appearance: AppearanceState,
  colorMapping: Record<string, ColorToken>
): ParsedSvgResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');

  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error('Некорректная XML-структура SVG');
  }

  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') {
    throw new Error('Корневым элементом файла должен быть <svg>');
  }

  // Проверка allowlist всех узлов и атрибутов
  const allElements = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of allElements) {
    const tag = el.tagName.toLowerCase();
    if (!ALLOWED_ELEMENTS.has(tag)) {
      throw new Error(`Неподдерживаемый SVG-элемент: <${tag}>`);
    }

    for (const attr of Array.from(el.attributes)) {
      const attrName = attr.name.toLowerCase();
      if (attrName.startsWith('on')) {
        throw new Error(`Запрещённый обработчик событий: ${attr.name}`);
      }
      if (!ALLOWED_ATTRS.has(attrName)) {
        throw new Error(`Неподдерживаемый атрибут "${attr.name}" в <${tag}>`);
      }
      if (attrName === 'xmlns') {
        if (attr.value.trim() !== 'http://www.w3.org/2000/svg') {
          throw new Error(`Недопустимое пространство имён xmlns: ${attr.value}`);
        }
        continue;
      }
      if (/javascript:|https?:\/\//i.test(attr.value)) {
        throw new Error(`Запрещённая внешняя или JS-ссылка в атрибуте ${attr.name}`);
      }
    }
  }

  const vbBounds = parseViewBox(root.getAttribute('viewBox'));
  const attrW = parseNumericAttr(root.getAttribute('width'));
  const attrH = parseNumericAttr(root.getAttribute('height'));

  const width = attrW ?? vbBounds?.width;
  const height = attrH ?? vbBounds?.height;

  if (!width || !height) {
    throw new Error('У SVG отсутствуют корректные width/height или viewBox');
  }

  const bounds: BoundingBox = vbBounds ?? { x: 0, y: 0, width, height };
  const viewBox =
    root.getAttribute('viewBox') ?? `0 0 ${bounds.width} ${bounds.height}`;

  // Собираем все векторные примитивы
  const shapeElements = Array.from(
    root.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line')
  ).filter((el) => !el.closest('defs'));

  const colorBindings: PathColorBinding[] = [];
  const unknownColorsSet = new Set<string>();
  const disallowedTokensSet = new Set<ColorToken>();

  shapeElements.forEach((el, index) => {
    const explicitToken = el.getAttribute('data-token') as ColorToken | null;
    const rawFill = el.getAttribute('fill');
    const rawStroke = el.getAttribute('stroke');

    const processAttr = (
      target: 'fill' | 'stroke',
      rawValue: string | null
    ) => {
      const normalized = normalizeColor(rawValue);
      if (normalized === 'none') return;

      if (
        target === 'fill' &&
        explicitToken &&
        (ALL_COLOR_TOKENS as readonly string[]).includes(explicitToken)
      ) {
        if (!isTokenAllowedForAppearance(explicitToken, appearance)) {
          disallowedTokensSet.add(explicitToken);
        }
        colorBindings.push({
          pathIndex: index,
          target,
          token: explicitToken,
          sourceColor: normalized,
        });
        return;
      }

      const mappedToken = resolveTokenForSourceColor(normalized, colorMapping);
      if (!mappedToken) {
        unknownColorsSet.add(normalized);
        return;
      }

      // Белый (#FFFFFF) в фоновых SVG допускается как неизменяемый блик без привязки к OBJ_4
      if (appearance === 'background' && normalized === '#FFFFFF') {
        return;
      }

      if (!isTokenAllowedForAppearance(mappedToken, appearance)) {
        disallowedTokensSet.add(mappedToken);
      }

      colorBindings.push({
        pathIndex: index,
        target,
        token: mappedToken,
        sourceColor: normalized,
      });
    };

    processAttr('fill', rawFill);
    processAttr('stroke', rawStroke);
  });

  return {
    width,
    height,
    viewBox,
    bounds,
    colorBindings,
    pathCount: shapeElements.length,
    unknownColors: Array.from(unknownColorsSet),
    disallowedTokens: Array.from(disallowedTokensSet),
  };
}