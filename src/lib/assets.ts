import JSZip from 'jszip';
import {
  APPEARANCE_STATES,
  AppearanceState,
  Asset,
  AssetVariant,
  ColorToken,
  DETAIL_PROFILES,
  DetailProfile,
  ImportReport,
} from '@/types';
import { buildColorMapFromScheme, PRESET_COLOR_SCHEMES } from './colors';
import { manifestSchema, parseAndValidateSvg } from './validation';

export interface LibraryLoadResult {
  assets: Asset[];
  report: ImportReport;
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/**
 * Единый движок сборки библиотеки из абстрактного словаря файлов { relativePath -> text }.
 */
async function buildLibraryFromFileMap(
  fileMap: Map<string, string>,
  manifestPath = 'manifest.json'
): Promise<LibraryLoadResult> {
  const report: ImportReport = {
    assetsCount: 0,
    variantsCount: 0,
    unknownColors: [],
    errors: [],
    warnings: [],
  };

  const manifestRaw = fileMap.get(manifestPath);
  if (!manifestRaw) {
    report.errors.push({
      file: manifestPath,
      message: 'Файл manifest.json не найден в корне библиотеки',
    });
    return { assets: [], report };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(manifestRaw);
  } catch {
    report.errors.push({
      file: manifestPath,
      message: 'Некорректный JSON в manifest.json',
    });
    return { assets: [], report };
  }

  const validation = manifestSchema.safeParse(parsedJson);
  if (!validation.success) {
    report.errors.push({
      file: manifestPath,
      message: `Ошибка структуры manifest.json: ${validation.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    });
    return { assets: [], report };
  }

  const manifest = validation.data;
  const colorMapping: Record<string, ColorToken> = manifest.colorMapping
    ? Object.fromEntries(
        Object.entries(manifest.colorMapping).map(([k, v]) => [
          k.trim().toUpperCase(),
          v,
        ])
      )
    : buildColorMapFromScheme(PRESET_COLOR_SCHEMES[0]);

  const seenIds = new Set<string>();
  const assets: Asset[] = [];

  for (const item of manifest.assets) {
    if (seenIds.has(item.id)) {
      report.errors.push({
        assetId: item.id,
        message: `Дублирующийся ID компонента: "${item.id}"`,
      });
      continue;
    }
    seenIds.add(item.id);

    const builtVariants: Partial<
      Record<DetailProfile, Record<AppearanceState, AssetVariant>>
    > = {};
    let hasAssetError = false;

    for (const profile of DETAIL_PROFILES) {
      const profileMap: Partial<Record<AppearanceState, AssetVariant>> = {};

      for (const appearance of APPEARANCE_STATES) {
        const relPath = normalizeRelativePath(item.variants[profile][appearance]);
        const svgContent = fileMap.get(relPath);

        if (!svgContent) {
          report.errors.push({
            assetId: item.id,
            file: relPath,
            message: `Не найден SVG-файл для ${item.id} (${profile}/${appearance}): ${relPath}`,
          });
          hasAssetError = true;
          continue;
        }

        try {
          const parsedSvg = parseAndValidateSvg(
            svgContent,
            appearance,
            colorMapping
          );

          if (parsedSvg.unknownColors.length > 0) {
            for (const color of parsedSvg.unknownColors) {
              report.unknownColors.push({ file: relPath, color });
            }
            report.warnings.push({
              assetId: item.id,
              file: relPath,
              message: `Найдены неизвестные цвета: ${parsedSvg.unknownColors.join(', ')}`,
            });
          }

          if (parsedSvg.disallowedTokens.length > 0) {
            report.errors.push({
              assetId: item.id,
              file: relPath,
              message: `Запрещённые токены для состояния "${appearance}": ${parsedSvg.disallowedTokens.join(', ')}`,
            });
            hasAssetError = true;
            continue;
          }

          profileMap[appearance] = {
            id: `${item.id}_${profile}_${appearance}`,
            detailProfile: profile,
            appearance,
            svg: svgContent,
            width: parsedSvg.width,
            height: parsedSvg.height,
            viewBox: parsedSvg.viewBox,
            bounds: parsedSvg.bounds,
            colorBindings: parsedSvg.colorBindings,
            pathCount: parsedSvg.pathCount,
          };
          report.variantsCount += 1;
        } catch (err) {
          report.errors.push({
            assetId: item.id,
            file: relPath,
            message: err instanceof Error ? err.message : 'Ошибка парсинга SVG',
          });
          hasAssetError = true;
        }
      }

      if (profileMap.main && profileMap.background) {
        builtVariants[profile] = {
          main: profileMap.main,
          background: profileMap.background,
        };
      }
    }

    if (hasAssetError || !builtVariants.S || !builtVariants.L) {
      continue;
    }

    // Сохраняем авторские пропорции объектов относительно друг друга на базе L-варианта
    const lBounds = builtVariants.L.main.bounds;
    const referenceSize = Math.max(lBounds.width, lBounds.height);

    assets.push({
      id: item.id,
      title: item.title,
      description: item.description,
      tags: item.tags,
      category: item.category,
      variants: {
        S: builtVariants.S,
        L: builtVariants.L,
      },
      referenceSize,
    });
  }

  report.assetsCount = assets.length;
  return { assets, report };
}

/**
 * Загружает предустановленную демо-библиотеку из public/demo-assets.
 */
export async function loadDemoLibrary(): Promise<LibraryLoadResult> {
  const baseUrl = '/demo-assets';
  const manifestRes = await fetch(`${baseUrl}/manifest.json`);
  if (!manifestRes.ok) {
    throw new Error('Не удалось загрузить /demo-assets/manifest.json');
  }

  const manifestText = await manifestRes.text();
  const fileMap = new Map<string, string>();
  fileMap.set('manifest.json', manifestText);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(manifestText);
  } catch {
    return buildLibraryFromFileMap(fileMap);
  }

  const validation = manifestSchema.safeParse(parsedJson);
  if (!validation.success) {
    return buildLibraryFromFileMap(fileMap);
  }

  const pathsToFetch = new Set<string>();
  for (const item of validation.data.assets) {
    for (const profile of DETAIL_PROFILES) {
      for (const appearance of APPEARANCE_STATES) {
        pathsToFetch.add(normalizeRelativePath(item.variants[profile][appearance]));
      }
    }
  }

  await Promise.all(
    Array.from(pathsToFetch).map(async (relPath) => {
      const res = await fetch(`${baseUrl}/${relPath}`);
      if (res.ok) {
        fileMap.set(relPath, await res.text());
      }
    })
  );

  return buildLibraryFromFileMap(fileMap);
}

/**
 * Импорт пользовательской библиотеки из ZIP-архива.
 */
export async function importLibraryFromZip(
  zipFile: File
): Promise<LibraryLoadResult> {
  const zip = await JSZip.loadAsync(zipFile);
  const rawEntries = new Map<string, string>();

  await Promise.all(
    Object.entries(zip.files).map(async ([path, entry]) => {
      if (entry.dir) return;
      const clean = normalizeRelativePath(path);
      if (clean.endsWith('.svg') || clean.endsWith('manifest.json')) {
        rawEntries.set(clean, await entry.async('string'));
      }
    })
  );

  // Поддержка случая, когда файлы лежат внутри одной общей папки архива
  let prefix = '';
  if (!rawEntries.has('manifest.json')) {
    const manifestKey = Array.from(rawEntries.keys()).find((k) =>
      k.endsWith('/manifest.json')
    );
    if (manifestKey) {
      prefix = manifestKey.slice(0, -'manifest.json'.length);
    }
  }

  const normalizedMap = new Map<string, string>();
  for (const [key, val] of rawEntries.entries()) {
    if (prefix && key.startsWith(prefix)) {
      normalizedMap.set(key.slice(prefix.length), val);
    } else {
      normalizedMap.set(key, val);
    }
  }

  return buildLibraryFromFileMap(normalizedMap);
}

/**
 * Импорт из директории (<input webkitdirectory />).
 */
export async function importLibraryFromDirectory(
  fileList: FileList
): Promise<LibraryLoadResult> {
  const rawEntries = new Map<string, string>();

  await Promise.all(
    Array.from(fileList).map(async (file) => {
      const rel = normalizeRelativePath(file.webkitRelativePath || file.name);
      if (rel.endsWith('.svg') || rel.endsWith('manifest.json')) {
        rawEntries.set(rel, await file.text());
      }
    })
  );

  let prefix = '';
  if (!rawEntries.has('manifest.json')) {
    const manifestKey = Array.from(rawEntries.keys()).find((k) =>
      k.endsWith('/manifest.json')
    );
    if (manifestKey) {
      prefix = manifestKey.slice(0, -'manifest.json'.length);
    }
  }

  const normalizedMap = new Map<string, string>();
  for (const [key, val] of rawEntries.entries()) {
    if (prefix && key.startsWith(prefix)) {
      normalizedMap.set(key.slice(prefix.length), val);
    } else {
      normalizedMap.set(key, val);
    }
  }

  return buildLibraryFromFileMap(normalizedMap);
}