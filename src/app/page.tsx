'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppearanceState,
  Asset,
  CanvasItem,
  ColorScheme,
  CompositionDocument,
  DetailProfile,
  ImportReport,
} from '@/types';
import { PRESET_COLOR_SCHEMES } from '@/lib/colors';
import {
  importLibraryFromDirectory,
  importLibraryFromZip,
  loadDemoLibrary,
} from '@/lib/assets';
import {
  getActiveCompositionId,
  loadAssetsFromStorage,
  loadColorSchemesFromStorage,
  loadCompositionsFromStorage,
  saveAssetsToStorage,
  saveCompositionToStorage,
  saveCustomColorSchemes,
} from '@/lib/storage';
import {
  buildDeterministicLayout,
  getCanonicalLibraryScale,
} from '@/lib/layout';
import { AiComposeResult } from '@/lib/ollama';
import {
  CanvasEditor,
  CanvasEditorHandle,
} from '@/components/editor/CanvasEditor';
import { Toolbar } from '@/components/editor/Toolbar';
import { LayerAction, LayersPanel } from '@/components/editor/LayersPanel';
import { AssetLibrary } from '@/components/library/AssetLibrary';
import { AssetImporter } from '@/components/library/AssetImporter';
import { PaletteEditor } from '@/components/palette/PaletteEditor';
import { CompositionGenerator } from '@/components/composition/CompositionGenerator';

function createEmptyDocument(): CompositionDocument {
  return {
    id: 'comp-initial',
    name: 'Новая композиция',
    artboard: { width: 1200, height: 800 },
    detailProfile: 'L',
    paletteId: PRESET_COLOR_SCHEMES[0].id,
    items: [],
    createdAt: 0,
    updatedAt: 0,
    backgroundFill: 'BG_1',
    backdropAssetId: null,
  };
}

export default function HomePage() {
  const canvasEditorRef = useRef<CanvasEditorHandle | null>(null);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [schemes, setSchemes] = useState<ColorScheme[]>(PRESET_COLOR_SCHEMES);
  const [doc, setDoc] = useState<CompositionDocument>(createEmptyDocument);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(
    null
  );
  const [bootstrapped, setBootstrapped] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<'library' | 'import'>('library');

  const backdropAssets = useMemo(
    () => assets.filter((a) => a.category === 'background'),
    [assets]
  );
  
  const assetsMap = useMemo(
    () => new Map(assets.map((a) => [a.id, a])),
    [assets]
  );

  const activeScheme = useMemo(
    () => schemes.find((s) => s.id === doc.paletteId) ?? schemes[0],
    [schemes, doc.paletteId]
  );

  const notify = useCallback((msg: string) => {
    setStatusNotice(msg);
    setTimeout(() => setStatusNotice(null), 3000);
  }, []);

  // Первичная загрузка из IndexedDB либо загрузка демо-библиотеки
  useEffect(() => {
    let active = true;

    async function init() {
      const [storedAssets, storedSchemes, storedComps, activeId] =
        await Promise.all([
          loadAssetsFromStorage(),
          loadColorSchemesFromStorage(),
          loadCompositionsFromStorage(),
          getActiveCompositionId(),
        ]);

      if (!active) return;

      if (storedSchemes.length > 0) {
        setSchemes(storedSchemes);
      }

      if (storedAssets && storedAssets.length > 0) {
        setAssets(storedAssets);
      }

      if (storedComps.length > 0) {
        const target =
          storedComps.find((c) => c.id === activeId) ?? storedComps[0];
        setDoc(target);
      } else {
        const now = Date.now();
        setDoc((prev) => ({
          ...prev,
          id: `comp-${now}`,
          createdAt: now,
          updatedAt: now,
        }));
      }

      setBootstrapped(true);
    }

    init();
    return () => {
      active = false;
    };
  }, []);

  // Автосохранение активной композиции в IndexedDB
  useEffect(() => {
    if (!bootstrapped) return;
    const timer = setTimeout(() => {
      saveCompositionToStorage(doc).catch(console.error);
    }, 500);
    return () => clearTimeout(timer);
  }, [doc, bootstrapped]);

  // Замена библиотеки через демо или импорт
  const applyLoadedLibrary = async (
    loader: () => Promise<{ assets: Asset[]; report: ImportReport }>
  ): Promise<ImportReport> => {
    const res = await loader();
    if (res.assets.length > 0) {
      setAssets(res.assets);
      await saveAssetsToStorage(res.assets);
      notify(`Загружено компонентов: ${res.assets.length}`);
    }
    return res.report;
  };

  // Добавление одного компонента кликом по карточке
  const handleAddSingleAsset = useCallback(
    (assetId: string) => {
      const asset = assetsMap.get(assetId);
      if (!asset || asset.category === 'background') return;

      const baseScale = getCanonicalLibraryScale(assets, doc.artboard);
      const maxZ = doc.items.reduce((m, i) => Math.max(m, i.zIndex), -1);
      const newId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `inst_${assetId}_${Date.now()}`;

      const offset = (doc.items.length % 5) * 24;
      const newItem: CanvasItem = {
        instanceId: newId,
        assetId,
        appearance: 'main',
        layoutRole: doc.items.length === 0 ? 'hero' : 'supporting',
        x: doc.artboard.width / 2 + offset,
        y: doc.artboard.height / 2 + offset,
        scale: baseScale,
        rotation: 0,
        zIndex: maxZ + 1,
      };

      setDoc((prev) => ({
        ...prev,
        items: [...prev.items, newItem],
        updatedAt: Date.now(),
      }));
      setSelectedInstanceId(newId);
    },
    [assets, assetsMap, doc.artboard, doc.items]
  );

  // Сценарий 1: AI-подбор по метафоре
  const handleApplyAiComposition = useCallback(
    (result: AiComposeResult) => {
      const placed = buildDeterministicLayout(result.items, assetsMap, {
        artboard: doc.artboard,
        detailProfile: doc.detailProfile,
        allAssets: assets,
      });
      setDoc((prev) => ({
        ...prev,
        items: placed,
        backdropAssetId: result.backdropAssetId,
        backgroundFill:
          prev.backgroundFill === 'none' && result.backdropAssetId
            ? 'BG_1'
            : prev.backgroundFill,
        updatedAt: Date.now(),
      }));
      setSelectedInstanceId(null);
      notify(`Собрана композиция из ${placed.length} объектов`);
    },
    [assets, assetsMap, doc.artboard, doc.detailProfile, notify]
  );

  // Сценарий 2: Автосборка из выбранных в библиотеке элементов
  const handleBuildFromSelection = useCallback(
    (assetIds: string[]) => {
      const placed = buildDeterministicLayout(
        assetIds.map((assetId) => ({ assetId })),
        assetsMap,
        {
          artboard: doc.artboard,
          detailProfile: doc.detailProfile,
	  allAssets: assets,
        },
      );
      setDoc((prev) => ({
        ...prev,
        items: placed,
        updatedAt: Date.now(),
      }));
      setSelectedInstanceId(null);
      notify(`Размещено компонентов: ${placed.length}`);
    },
    [assets, assetsMap, doc.artboard, doc.detailProfile, notify]
  );

  // Обновление трансформаций из Fabric Canvas
  const handleUpdateItems = useCallback(
    (
      updates: Array<
        { instanceId: string } & Partial<
          Pick<CanvasItem, 'x' | 'y' | 'scale' | 'rotation'>
        >
      >
    ) => {
      const updateMap = new Map(updates.map((u) => [u.instanceId, u]));
      setDoc((prev) => ({
        ...prev,
        items: prev.items.map((item) => {
          const patch = updateMap.get(item.instanceId);
          return patch ? { ...item, ...patch } : item;
        }),
        updatedAt: Date.now(),
      }));
    },
    []
  );

  const handleDuplicate = useCallback((instanceId: string) => {
    setDoc((prev) => {
      const source = prev.items.find((i) => i.instanceId === instanceId);
      if (!source) return prev;
      const maxZ = prev.items.reduce((m, i) => Math.max(m, i.zIndex), -1);
      const copyId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `copy_${Date.now()}`;
      const copy: CanvasItem = {
        ...source,
        instanceId: copyId,
        x: source.x + 24,
        y: source.y + 24,
        zIndex: maxZ + 1,
      };
      setSelectedInstanceId(copyId);
      return {
        ...prev,
        items: [...prev.items, copy],
        updatedAt: Date.now(),
      };
    });
  }, []);

  const handleDelete = useCallback((instanceId: string) => {
    setDoc((prev) => ({
      ...prev,
      items: prev.items
        .filter((i) => i.instanceId !== instanceId)
        .map((item, idx) => ({ ...item, zIndex: idx })),
      updatedAt: Date.now(),
    }));
    setSelectedInstanceId((curr) => (curr === instanceId ? null : curr));
  }, []);

  const handleChangeAppearance = useCallback(
    (instanceId: string, appearance: AppearanceState) => {
      setDoc((prev) => ({
        ...prev,
        items: prev.items.map((item) =>
          item.instanceId === instanceId ? { ...item, appearance } : item
        ),
        updatedAt: Date.now(),
      }));
    },
    []
  );

  const handleMoveLayer = useCallback(
    (instanceId: string, action: LayerAction) => {
      setDoc((prev) => {
        const sorted = [...prev.items].sort((a, b) => a.zIndex - b.zIndex);
        const idx = sorted.findIndex((i) => i.instanceId === instanceId);
        if (idx === -1) return prev;

        const [moved] = sorted.splice(idx, 1);
        if (action === 'front') sorted.push(moved);
        else if (action === 'back') sorted.unshift(moved);
        else if (action === 'forward')
          sorted.splice(Math.min(idx + 1, sorted.length), 0, moved);
        else if (action === 'backward')
          sorted.splice(Math.max(idx - 1, 0), 0, moved);

        return {
          ...prev,
          items: sorted.map((item, i) => ({ ...item, zIndex: i })),
          updatedAt: Date.now(),
        };
      });
    },
    []
  );

  // Изменение размеров Artboard с пропорциональным вписыванием по коэффициенту k (Раздел 5.3)
  const handleChangeArtboard = useCallback((newW: number, newH: number) => {
    setDoc((prev) => {
      const oldW = prev.artboard.width;
      const oldH = prev.artboard.height;
      if (oldW === newW && oldH === newH) return prev;

      // Обратимый коэффициент по меньшей стороне Artboard (не уменьшает объекты при круговом переключении)
      const k = Math.min(newW, newH) / Math.min(oldW, oldH);
      const updatedItems = prev.items.map((item) => ({
        ...item,
        x: Math.round((newW / 2 + (item.x - oldW / 2) * k) * 100) / 100,
        y: Math.round((newH / 2 + (item.y - oldH / 2) * k) * 100) / 100,
        scale: Math.round(item.scale * k * 10000) / 10000,
      }));

      return {
        ...prev,
        artboard: { width: newW, height: newH },
        items: updatedItems,
        updatedAt: Date.now(),
      };
    });
  }, []);

  const handleChangeDetailProfile = useCallback((profile: DetailProfile) => {
    setDoc((prev) => ({
      ...prev,
      detailProfile: profile,
      updatedAt: Date.now(),
    }));
  }, []);

  // Управление палитрами
  const handleSelectPalette = useCallback((paletteId: string) => {
    setDoc((prev) => ({ ...prev, paletteId, updatedAt: Date.now() }));
  }, []);

  const handleUpdateScheme = useCallback(async (updated: ColorScheme) => {
    setSchemes((prev) => {
      const next = prev.map((s) => (s.id === updated.id ? updated : s));
      saveCustomColorSchemes(next).catch(console.error);
      return next;
    });
  }, []);

  const handleCreateScheme = useCallback(async (created: ColorScheme) => {
    setSchemes((prev) => {
      const next = [...prev, created];
      saveCustomColorSchemes(next).catch(console.error);
      return next;
    });
    setDoc((prev) => ({ ...prev, paletteId: created.id, updatedAt: Date.now() }));
  }, []);

  const handleDeleteScheme = useCallback(async (id: string) => {
    setSchemes((prev) => {
      const next = prev.filter((s) => s.id !== id);
      saveCustomColorSchemes(next).catch(console.error);
      return next;
    });
    setDoc((prev) => ({
      ...prev,
      paletteId:
        prev.paletteId === id ? PRESET_COLOR_SCHEMES[0].id : prev.paletteId,
      updatedAt: Date.now(),
    }));
  }, []);

  // Экспорт в SVG
  const handleExportSvg = useCallback(() => {
    const svgOutput = canvasEditorRef.current?.exportSvg();
    if (!svgOutput) return;

    const blob = new Blob([svgOutput], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `composition-${doc.detailProfile.toLowerCase()}-${doc.artboard.width}x${doc.artboard.height}.svg`;
    a.click();
    URL.revokeObjectURL(url);
    notify('SVG успешно экспортирован');
  }, [doc.artboard.height, doc.artboard.width, doc.detailProfile, notify]);

  const handleSaveProject = useCallback(async () => {
    await saveCompositionToStorage(doc);
    notify('Композиция сохранена в браузере');
  }, [doc, notify]);

  const handleClearCanvas = useCallback(() => {
    setDoc((prev) => ({ ...prev, items: [], updatedAt: Date.now() }));
    setSelectedInstanceId(null);
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50 text-slate-900">
      <Toolbar
        artboard={doc.artboard}
        detailProfile={doc.detailProfile}
        itemsCount={doc.items.length}
        onChangeArtboard={handleChangeArtboard}
        onChangeDetailProfile={handleChangeDetailProfile}
        onExportSvg={handleExportSvg}
        onSaveProject={handleSaveProject}
        onClearCanvas={handleClearCanvas}
      />

      <div className="flex min-h-0 flex-1">
        {/* Левая панель: AI-сборка + Библиотека и Импорт */}
        <aside className="flex w-80 shrink-0 flex-col border-r border-slate-200 bg-white">
          <div className="border-b border-slate-200 p-3">
            <CompositionGenerator
              assets={assets}
              onApplyAiComposition={handleApplyAiComposition}
            />
          </div>

          <div className="flex border-b border-slate-200 text-xs font-medium">
            <button
              type="button"
              onClick={() => setLeftTab('library')}
              className={`flex-1 py-2 text-center transition ${
                leftTab === 'library'
                  ? 'border-b-2 border-indigo-600 text-indigo-600'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Библиотека ({assets.filter((a) => a.category !== 'background').length})
            </button>
            <button
              type="button"
              onClick={() => setLeftTab('import')}
              className={`flex-1 py-2 text-center transition ${
                leftTab === 'import'
                  ? 'border-b-2 border-indigo-600 text-indigo-600'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Импорт / Демо
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {leftTab === 'library' ? (
              <AssetLibrary
                assets={assets}
                detailProfile={doc.detailProfile}
                activeScheme={activeScheme}
                onAddSingle={handleAddSingleAsset}
                onBuildFromSelection={handleBuildFromSelection}
                onLoadDemo={() => applyLoadedLibrary(loadDemoLibrary)}
                onSwitchToImport={() => setLeftTab('import')}
              />
            ) : (
              <AssetImporter
                onImportZip={(file) =>
                  applyLoadedLibrary(() => importLibraryFromZip(file))
                }
                onImportDirectory={(files) =>
                  applyLoadedLibrary(() => importLibraryFromDirectory(files))
                }
                onReloadDemo={() => applyLoadedLibrary(loadDemoLibrary)}
              />
            )}
          </div>
        </aside>

        {/* Центр: Холст Fabric.js */}
        <CanvasEditor
          ref={canvasEditorRef}
          doc={doc}
          assetsMap={assetsMap}
          activeScheme={activeScheme}
          selectedInstanceId={selectedInstanceId}
          onSelectInstance={setSelectedInstanceId}
          onUpdateItems={handleUpdateItems}
          onDuplicateSelected={() => {
            if (selectedInstanceId) handleDuplicate(selectedInstanceId);
          }}
          onDeleteSelected={() => {
            if (selectedInstanceId) handleDelete(selectedInstanceId);
          }}
        />

        {/* Правая панель: Цветовая схема + Слои/Инспектор */}
        <aside className="flex w-80 shrink-0 flex-col gap-5 overflow-y-auto border-l border-slate-200 bg-white p-3.5">
          <PaletteEditor
            schemes={schemes}
            activePaletteId={doc.paletteId}
            onSelectPalette={handleSelectPalette}
            onUpdateScheme={handleUpdateScheme}
            onCreateScheme={handleCreateScheme}
            onDeleteScheme={handleDeleteScheme}
            backgroundFill={doc.backgroundFill}
            onChangeBackgroundFill={(backgroundFill) =>
              setDoc((prev) => ({ ...prev, backgroundFill, updatedAt: Date.now() }))
            }
            backdropAssets={backdropAssets}
            backdropAssetId={doc.backdropAssetId}
            onChangeBackdrop={(backdropAssetId) =>
              setDoc((prev) => ({ ...prev, backdropAssetId, updatedAt: Date.now() }))
            }
          />

          <div className="h-px bg-slate-200" />

          <LayersPanel
            items={doc.items}
            assetsMap={assetsMap}
            selectedInstanceId={selectedInstanceId}
            onSelectInstance={setSelectedInstanceId}
            onChangeAppearance={handleChangeAppearance}
            onMoveLayer={handleMoveLayer}
            onDuplicate={handleDuplicate}
            onDelete={handleDelete}
          />
        </aside>
      </div>

      {/* Всплывающее уведомление */}
      {statusNotice && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white shadow-lg">
          {statusNotice}
        </div>
      )}
    </div>
  );
}