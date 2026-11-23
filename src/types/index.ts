export const DETAIL_PROFILES = ['S', 'L'] as const;
export type DetailProfile = (typeof DETAIL_PROFILES)[number];

export const APPEARANCE_STATES = ['main', 'background'] as const;
export type AppearanceState = (typeof APPEARANCE_STATES)[number];

export const BG_TOKENS = ['BG_1', 'BG_2', 'BG_3', 'BG_4'] as const;
export const OBJ_TOKENS = ['OBJ_1', 'OBJ_2', 'OBJ_3', 'OBJ_4'] as const;
export const ALL_COLOR_TOKENS = [...BG_TOKENS, ...OBJ_TOKENS] as const;

export type BgColorToken = (typeof BG_TOKENS)[number];
export type ObjColorToken = (typeof OBJ_TOKENS)[number];
export type ColorToken = (typeof ALL_COLOR_TOKENS)[number];

export type LayoutRole = 'hero' | 'supporting' | 'backdrop';

export type AiProviderType = 'ollama' | 'openai';

export interface AiClientConfig {
  useCustomConfig: boolean;
  provider: AiProviderType;
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
}

export interface PathColorBinding {
  pathIndex: number;
  target: 'fill' | 'stroke';
  token: ColorToken;
  sourceColor: string;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AssetVariant {
  id: string;
  detailProfile: DetailProfile;
  appearance: AppearanceState;
  svg: string;
  width: number;
  height: number;
  viewBox: string;
  bounds: BoundingBox;
  colorBindings: PathColorBinding[];
  pathCount: number;
}

export interface Asset {
  id: string;
  title: string;
  description: string;
  tags: string[];
  category?: string;
  variants: Record<DetailProfile, Record<AppearanceState, AssetVariant>>;
  /** Максимальный размер L-варианта для сохранения авторских пропорций между компонентами */
  referenceSize: number;
}

export interface AssetMetadata {
  id: string;
  title: string;
  description: string;
  tags: string[];
  category?: string;
}

export interface ColorScheme {
  id: string;
  name: string;
  isPreset?: boolean;
  background: Record<BgColorToken, string>;
  objects: Record<ObjColorToken, string>;
}

export interface CanvasItem {
  instanceId: string;
  assetId: string;
  appearance: AppearanceState;
  layoutRole?: LayoutRole;
  /** Координаты центра экземпляра на Artboard */
  x: number;
  y: number;
  /** Логический равномерный масштаб относительно L-эталона */
  scale: number;
  rotation: number;
  zIndex: number;
}

export interface CompositionDocument {
  id: string;
  name: string;
  artboard: {
    width: number;
    height: number;
  };
  /** Заливка самого Artboard: только фоновые токены или прозрачный (alpha) */
  backgroundFill: 'none' | BgColorToken;
  /** ID фонового шаблона (например, B01, B02) или null — только заливка */
  backdropAssetId: string | null;
  detailProfile: DetailProfile;
  paletteId: string;
  items: CanvasItem[];
  createdAt: number;
  updatedAt: number;
}

export interface ImportErrorItem {
  file?: string;
  assetId?: string;
  message: string;
}

export interface ImportReport {
  assetsCount: number;
  variantsCount: number;
  unknownColors: Array<{ file: string; color: string }>;
  errors: ImportErrorItem[];
  warnings: ImportErrorItem[];
}