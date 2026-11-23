'use client';

import React, { useRef, useState } from 'react';
import { Copy, Download, Palette, Plus, Trash2, Upload } from 'lucide-react';
import {
  Asset,
  BG_TOKENS,
  BgColorToken,
  ColorScheme,
  OBJ_TOKENS,
  ObjColorToken,
} from '@/types';
import { colorSchemeSchema } from '@/lib/validation';

interface PaletteEditorProps {
  schemes: ColorScheme[];
  activePaletteId: string;
  onSelectPalette: (id: string) => void;
  onUpdateScheme: (scheme: ColorScheme) => void;
  onCreateScheme: (scheme: ColorScheme) => void;
  onDeleteScheme: (id: string) => void;
  backgroundFill: 'none' | BgColorToken;
  onChangeBackgroundFill: (fill: 'none' | BgColorToken) => void;
  backdropAssets: Asset[];
  backdropAssetId: string | null;
  onChangeBackdrop: (id: string | null) => void;
}

export function PaletteEditor({
  schemes,
  activePaletteId,
  onSelectPalette,
  onUpdateScheme,
  onCreateScheme,
  onDeleteScheme,
  backgroundFill,
  onChangeBackgroundFill,
  backdropAssets,
  backdropAssetId,
  onChangeBackdrop,
}: PaletteEditorProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const activeScheme =
    schemes.find((s) => s.id === activePaletteId) ?? schemes[0];

  const duplicateAsCustom = (base: ColorScheme): ColorScheme => ({
    ...base,
    id: `custom-${Date.now()}`,
    name: `${base.name} (Копия)`,
    isPreset: false,
    background: { ...base.background },
    objects: { ...base.objects },
  });

  const handleTokenChange = (
    group: 'background' | 'objects',
    token: BgColorToken | ObjColorToken,
    hex: string
  ) => {
    const normalized = hex.toUpperCase();
    // Пресеты не перезаписываем напрямую — при изменении автоматически клонируем в кастомную схему
    if (activeScheme.isPreset) {
      const cloned = duplicateAsCustom(activeScheme);
      if (group === 'background') {
        cloned.background[token as BgColorToken] = normalized;
      } else {
        cloned.objects[token as ObjColorToken] = normalized;
      }
      onCreateScheme(cloned);
      return;
    }

    const updated: ColorScheme = {
      ...activeScheme,
      background: { ...activeScheme.background },
      objects: { ...activeScheme.objects },
    };
    if (group === 'background') {
      updated.background[token as BgColorToken] = normalized;
    } else {
      updated.objects[token as ObjColorToken] = normalized;
    }
    onUpdateScheme(updated);
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(activeScheme, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeScheme.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJson = async (file: File) => {
    setImportError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = colorSchemeSchema.safeParse(parsed);
      if (!res.success) {
        setImportError(
          res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        );
        return;
      }
      onCreateScheme({
        ...res.data,
        id: `imported-${Date.now()}`,
        isPreset: false,
      });
    } catch {
      setImportError('Некорректный JSON файл палитры');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <Palette className="h-3.5 w-3.5" />
          Цветовая схема
        </span>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onCreateScheme(duplicateAsCustom(activeScheme))}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            title="Дублировать схему"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            title="Импорт JSON"
          >
            <Upload className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            title="Экспорт JSON"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Выбор схемы */}
      <div className="flex items-center gap-1.5">
        <select
          value={activeScheme.id}
          onChange={(e) => onSelectPalette(e.target.value)}
          className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:outline-none"
        >
          {schemes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        {!activeScheme.isPreset && (
          <button
            type="button"
            onClick={() => onDeleteScheme(activeScheme.id)}
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
            title="Удалить схему"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Название для пользовательской схемы */}
      {!activeScheme.isPreset && (
        <input
          type="text"
          value={activeScheme.name}
          onChange={(e) =>
            onUpdateScheme({ ...activeScheme, name: e.target.value })
          }
          className="w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-700"
          placeholder="Название палитры"
        />
      )}

      <button
        type="button"
        onClick={() => onCreateScheme(duplicateAsCustom(activeScheme))}
        className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-slate-200 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
      >
        <Plus className="h-3.5 w-3.5" />
        Создать на основе текущей
      </button>

      {/* 4 фоновых слота */}
      <div>
        <span className="mb-1 block text-[11px] font-medium text-slate-500">
          Фоновые токены (BG)
        </span>
        <div className="grid grid-cols-4 gap-1.5">
          {BG_TOKENS.map((token) => (
            <label
              key={token}
              className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-slate-200 bg-white p-1.5 hover:border-slate-300"
            >
              <input
                type="color"
                value={activeScheme.background[token]}
                onChange={(e) =>
                  handleTokenChange('background', token, e.target.value)
                }
                className="h-6 w-full cursor-pointer rounded border-0 bg-transparent p-0"
              />
              <span className="text-[10px] font-medium text-slate-600">
                {token}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* 4 объектных слота */}
      <div>
        <span className="mb-1 block text-[11px] font-medium text-slate-500">
          Объектные токены (OBJ)
        </span>
        <div className="grid grid-cols-4 gap-1.5">
          {OBJ_TOKENS.map((token) => (
            <label
              key={token}
              className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-slate-200 bg-white p-1.5 hover:border-slate-300"
            >
              <input
                type="color"
                value={activeScheme.objects[token]}
                onChange={(e) =>
                  handleTokenChange('objects', token, e.target.value)
                }
                className="h-6 w-full cursor-pointer rounded border-0 bg-transparent p-0"
              />
              <span className="text-[10px] font-medium text-slate-600">
                {token}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Фон холста (Artboard) — только BG_1..BG_4 или прозрачный */}
      <div>
        <span className="mb-1 block text-[11px] font-medium text-slate-500">
          Фон холста (Artboard)
        </span>
        <div className="grid grid-cols-5 gap-1">
          <button
            type="button"
            onClick={() => onChangeBackgroundFill('none')}
            className={`flex h-8 items-center justify-center rounded-lg border text-[10px] font-medium transition ${
              backgroundFill === 'none'
                ? 'border-indigo-600 ring-1 ring-indigo-500 text-indigo-700 bg-indigo-50'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
            }`}
            title="Прозрачный фон (Alpha)"
          >
            Alpha
          </button>
          {BG_TOKENS.map((token) => (
            <button
              key={token}
              type="button"
              onClick={() => onChangeBackgroundFill(token)}
              className={`flex h-8 flex-col items-center justify-center rounded-lg border transition ${
                backgroundFill === token
                  ? 'border-indigo-600 ring-2 ring-indigo-400'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
              style={{ backgroundColor: activeScheme.background[token] }}
              title={`Залить холст ${token}`}
            >
              <span className="rounded bg-white/80 px-1 text-[9px] font-semibold text-slate-800">
                {token}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Декоративные фоновые шаблоны (B01, B02 и т.д.) */}
      {backdropAssets.length > 0 && (
        <div>
          <span className="mb-1 block text-[11px] font-medium text-slate-500">
            Декор фона
          </span>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => onChangeBackdrop(null)}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
                backdropAssetId === null
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              }`}
            >
              Только заливка
            </button>
            {backdropAssets.map((bg) => (
              <button
                key={bg.id}
                type="button"
                onClick={() => onChangeBackdrop(bg.id)}
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
                  backdropAssetId === bg.id
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                {bg.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {importError && (
        <div className="rounded-lg bg-red-50 p-2 text-[11px] text-red-700">
          {importError}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImportJson(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}