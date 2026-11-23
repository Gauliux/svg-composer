'use client';

import React, { useMemo, useState } from 'react';
import { Check, Plus, Search, Sparkles } from 'lucide-react';
import {
  Asset,
  AssetVariant,
  ColorScheme,
  DetailProfile,
  ColorToken,
} from '@/types';
import { resolveColorFromScheme } from '@/lib/colors';
import { extractCategories, searchAssets } from '@/lib/search';

interface AssetLibraryProps {
  assets: Asset[];
  detailProfile: DetailProfile;
  activeScheme: ColorScheme;
  onAddSingle: (assetId: string) => void;
  onBuildFromSelection: (assetIds: string[]) => void;
  onLoadDemo?: () => Promise<unknown>;
  onSwitchToImport?: () => void;
}

/**
 * Безопасная перекраска SVG-строки для миниатюры без вставки в активный DOM.
 */
function buildPreviewDataUrl(
  variant: AssetVariant,
  scheme: ColorScheme
): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(variant.svg, 'image/svg+xml');
    const shapes = doc.querySelectorAll(
      'path, rect, circle, ellipse, polygon, polyline, line'
    );
    const bindingsMap = new Map(
      variant.colorBindings.map((b) => [b.pathIndex, b.token])
    );

    const fillMap = new Map<number, ColorToken>();
    const strokeMap = new Map<number, ColorToken>();
    for (const b of variant.colorBindings) {
      if (b.target === 'stroke') strokeMap.set(b.pathIndex, b.token);
      else fillMap.set(b.pathIndex, b.token);
    }

    shapes.forEach((el, idx) => {
      const fToken = fillMap.get(idx);
      if (fToken) {
        el.setAttribute(
          'fill',
          resolveColorFromScheme(scheme, fToken, variant.appearance)
        );
      }
      const sToken = strokeMap.get(idx);
      if (sToken) {
        el.setAttribute(
          'stroke',
          resolveColorFromScheme(scheme, sToken, variant.appearance)
        );
      }
    });

    const serialized = new XMLSerializer().serializeToString(doc.documentElement);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
  } catch {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(variant.svg)}`;
  }
}

export function AssetLibrary({
  assets,
  detailProfile,
  activeScheme,
  onAddSingle,
  onBuildFromSelection,
  onLoadDemo,
  onSwitchToImport,
}: AssetLibraryProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Показываем в библиотеке только предметные объекты (фоны выбираются в PaletteEditor)
  const objectAssets = useMemo(
    () => assets.filter((a) => a.category !== 'background'),
    [assets]
  );

  const categories = useMemo(
    () => extractCategories(objectAssets),
    [objectAssets]
  );
  const filteredAssets = useMemo(
    () => searchAssets(objectAssets, query, category),
    [objectAssets, query, category]
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const [demoLoading, setDemoLoading] = useState(false);

  if (objectAssets.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-5 text-center">
        <div className="text-xs font-semibold text-slate-700">
          Библиотека компонентов пуста
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500">
          Загрузите собственную библиотеку (ZIP / папка) или используйте готовую
          демо-библиотеку из 10 объектов и 2 фонов.
        </p>
        {onLoadDemo && (
          <button
            type="button"
            disabled={demoLoading}
            onClick={async () => {
              setDemoLoading(true);
              try {
                await onLoadDemo();
              } finally {
                setDemoLoading(false);
              }
            }}
            className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {demoLoading ? 'Загрузка...' : 'Загрузить демо-библиотеку'}
          </button>
        )}
        {onSwitchToImport && (
          <button
            type="button"
            onClick={onSwitchToImport}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Импортировать свою библиотеку
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Поиск (Fuse.js) */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск компонентов и тегов..."
          className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      {/* Фильтр категорий */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setCategory('all')}
            className={`rounded-md px-2 py-1 text-[11px] font-medium ${
              category === 'all'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Все
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                category === cat
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Панель Сценария 2 (автосборка выбранных) */}
      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-indigo-50 p-2 ring-1 ring-indigo-200">
          <button
            type="button"
            onClick={() => {
              onBuildFromSelection(selectedIds);
              setSelectedIds([]);
            }}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Собрать сцену ({selectedIds.length})
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds([])}
            className="rounded px-2 py-1.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100"
          >
            Сброс
          </button>
        </div>
      )}

      {/* Сетка компонентов */}
      {filteredAssets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
          Компоненты не найдены
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {filteredAssets.map((asset) => {
            const variant = asset.variants[detailProfile].main;
            const previewUrl = buildPreviewDataUrl(variant, activeScheme);
            const isChecked = selectedIds.includes(asset.id);

            return (
              <div
                key={asset.id}
                className={`group relative flex flex-col rounded-xl border bg-white p-2 transition ${
                  isChecked
                    ? 'border-indigo-500 ring-1 ring-indigo-400'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                {/* Чекбокс для Сценария 2 */}
                <button
                  type="button"
                  onClick={() => toggleSelect(asset.id)}
                  className={`absolute left-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded border text-white transition ${
                    isChecked
                      ? 'border-indigo-600 bg-indigo-600'
                      : 'border-slate-300 bg-white/90 opacity-0 group-hover:opacity-100'
                  }`}
                  title="Выбрать для авто-композиции"
                >
                  {isChecked && <Check className="h-3 w-3" />}
                </button>

                {/* Превью */}
                <button
                  type="button"
                  onClick={() => onAddSingle(asset.id)}
                  className="flex h-20 w-full items-center justify-center overflow-hidden rounded-lg bg-slate-50 p-1.5"
                  title="Кликните, чтобы добавить на холст"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt={asset.title}
                    className="max-h-full max-w-full object-contain"
                  />
                </button>

                <div className="mt-1.5 flex items-center justify-between gap-1">
                  <span
                    className="truncate text-[11px] font-medium text-slate-700"
                    title={asset.title}
                  >
                    {asset.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => onAddSingle(asset.id)}
                    className="shrink-0 rounded bg-slate-100 p-1 text-slate-600 hover:bg-indigo-600 hover:text-white"
                    title="Добавить на холст"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}