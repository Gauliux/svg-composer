import {
  AppearanceState,
  BG_TOKENS,
  BgColorToken,
  ColorScheme,
  ColorToken,
  OBJ_TOKENS,
} from '@/types';

export const PRESET_COLOR_SCHEMES: ColorScheme[] = [
  {
    id: 'palette-1',
    name: 'Палитра 1 (Лаванда)',
    isPreset: true,
    background: {
      BG_1: '#D7CDF5',
      BG_2: '#AA9BF0',
      BG_3: '#7864D7',
      BG_4: '#181817',
    },
    objects: {
      OBJ_1: '#F9ECB0',
      OBJ_2: '#F9A3AA',
      OBJ_3: '#FFE3E1',
      OBJ_4: '#FFFFFF',
    },
  },
  {
    id: 'palette-2',
    name: 'Палитра 2 (Тёплая)',
    isPreset: true,
    background: {
      BG_1: '#FDD7B9',
      BG_2: '#FAC896',
      BG_3: '#D27532',
      BG_4: '#181817',
    },
    objects: {
      OBJ_1: '#F9ECB0',
      OBJ_2: '#80DADA',
      OBJ_3: '#BEEBEB',
      OBJ_4: '#FFFFFF',
    },
  },
  {
    id: 'palette-3',
    name: 'Палитра 3 (Мята)',
    isPreset: true,
    background: {
      BG_1: '#BEEBEB',
      BG_2: '#80DADA',
      BG_3: '#5ABEBE',
      BG_4: '#181817',
    },
    objects: {
      OBJ_1: '#FFD4F2',
      OBJ_2: '#6D7BFC',
      OBJ_3: '#B6C6FE',
      OBJ_4: '#FFFFFF',
    },
  },
];

const NAMED_COLORS: Record<string, string> = {
  white: '#FFFFFF',
  black: '#000000',
  red: '#FF0000',
  green: '#008000',
  blue: '#0000FF',
  none: 'none',
  transparent: 'none',
};

/**
 * Приводит CSS/SVG цвет к единому формату #RRGGBB (в верхнем регистре) или 'none'.
 */
export function normalizeColor(raw: string | null | undefined): string {
  if (!raw) return 'none';
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed === 'none' || trimmed === 'transparent') {
    return 'none';
  }
  if (NAMED_COLORS[trimmed]) {
    return NAMED_COLORS[trimmed];
  }

  // #RGB -> #RRGGBB
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }

  // #RRGGBB
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  // #RRGGBBAA -> #RRGGBB (если альфа не используется, либо сохраняем как есть)
  if (/^#[0-9a-f]{8}$/i.test(trimmed)) {
    return trimmed.slice(0, 7).toUpperCase();
  }

  // rgb(r, g, b)
  const rgbMatch = trimmed.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgbMatch) {
    const toHex = (n: string) =>
      Math.max(0, Math.min(255, Number(n)))
        .toString(16)
        .padStart(2, '0')
        .toUpperCase();
    return `#${toHex(rgbMatch[1])}${toHex(rgbMatch[2])}${toHex(rgbMatch[3])}`;
  }

  return trimmed.toUpperCase();
}

/**
 * Дефолтная карта соответствия HEX -> Token (построенная на Палитре 1).
 * Может быть переопределена пользовательским colorMapping в manifest.json.
 */
export function buildColorMapFromScheme(
  scheme: ColorScheme = PRESET_COLOR_SCHEMES[0]
): Record<string, ColorToken> {
  const map: Record<string, ColorToken> = {};
  for (const token of BG_TOKENS) {
    map[normalizeColor(scheme.background[token])] = token;
  }
  for (const token of OBJ_TOKENS) {
    map[normalizeColor(scheme.objects[token])] = token;
  }
  return map;
}

export function isBgToken(token: ColorToken): token is BgColorToken {
  return (BG_TOKENS as readonly string[]).includes(token);
}

/**
 * Проверяет, разрешён ли токен для данного состояния (main vs background).
 */
export function isTokenAllowedForAppearance(
  token: ColorToken,
  appearance: AppearanceState
): boolean {
  if (appearance === 'main') return true;
  return isBgToken(token);
}

/**
 * Возвращает HEX из активной цветовой схемы по токену.
 * Если вдруг у background-элемента оказался OBJ-токен — защитно мапит на BG_1.
 */
export function resolveColorFromScheme(
  scheme: ColorScheme,
  token: ColorToken,
  appearance: AppearanceState
): string {
  if (isBgToken(token)) {
    return scheme.background[token];
  }
  if (appearance === 'background') {
    // Нарушение контракта (OBJ токен в background SVG) — безопасный fallback
    return scheme.background.BG_1;
  }
  return scheme.objects[token];
}