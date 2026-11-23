'use client';

import React, { useState } from 'react';
import { Download, Layers, Save, Trash2 } from 'lucide-react';
import { DETAIL_PROFILES, DetailProfile } from '@/types';

const ARTBOARD_PRESETS = [
  { label: 'Квадрат (1:1)', width: 1080, height: 1080 },
  { label: 'Горизонтальный (16:9)', width: 1200, height: 675 },
  { label: 'Баннер (3:2)', width: 1200, height: 800 },
  { label: 'Вертикальный (9:16)', width: 1080, height: 1920 },
];

interface ToolbarProps {
  artboard: { width: number; height: number };
  detailProfile: DetailProfile;
  itemsCount: number;
  onChangeArtboard: (width: number, height: number) => void;
  onChangeDetailProfile: (profile: DetailProfile) => void;
  onExportSvg: () => void;
  onSaveProject: () => void;
  onClearCanvas: () => void;
}

export function Toolbar({
  artboard,
  detailProfile,
  itemsCount,
  onChangeArtboard,
  onChangeDetailProfile,
  onExportSvg,
  onSaveProject,
  onClearCanvas,
}: ToolbarProps) {
  const [customW, setCustomW] = useState(String(artboard.width));
  const [customH, setCustomH] = useState(String(artboard.height));

  const currentPresetKey = `${artboard.width}x${artboard.height}`;
  const isPreset = ARTBOARD_PRESETS.some(
    (p) => `${p.width}x${p.height}` === currentPresetKey
  );

  const handlePresetChange = (value: string) => {
    const [w, h] = value.split('x').map(Number);
    if (w > 0 && h > 0) {
      setCustomW(String(w));
      setCustomH(String(h));
      onChangeArtboard(w, h);
    }
  };

  const applyCustomSize = () => {
    const w = Math.max(200, Math.min(4096, Number(customW) || artboard.width));
    const h = Math.max(200, Math.min(4096, Number(customH) || artboard.height));
    setCustomW(String(w));
    setCustomH(String(h));
    onChangeArtboard(w, h);
  };

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold leading-tight text-slate-900">
              SVG Composer
            </h1>
            <p className="text-[11px] text-slate-500">
              Векторный конструктор композиций
            </p>
          </div>
        </div>

        <div className="h-6 w-px bg-slate-200" />

        {/* Переключатель профиля детализации S / L */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-slate-600">Детализация:</span>
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
            {DETAIL_PROFILES.map((profile) => (
              <button
                key={profile}
                type="button"
                onClick={() => onChangeDetailProfile(profile)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                  detailProfile === profile
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {profile}
              </button>
            ))}
          </div>
        </div>

        <div className="h-6 w-px bg-slate-200" />

        {/* Формат Artboard */}
        <div className="flex items-center gap-2">
          <select
            value={isPreset ? currentPresetKey : 'custom'}
            onChange={(e) => {
              if (e.target.value !== 'custom') {
                handlePresetChange(e.target.value);
              }
            }}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:outline-none"
          >
            {ARTBOARD_PRESETS.map((p) => (
              <option key={p.label} value={`${p.width}x${p.height}`}>
                {p.label} ({p.width}×{p.height})
              </option>
            ))}
            {!isPreset && (
              <option value="custom">
                Свой ({artboard.width}×{artboard.height})
              </option>
            )}
          </select>

          <div className="flex items-center gap-1">
            <input
              type="number"
              min={200}
              max={4096}
              value={customW}
              onChange={(e) => setCustomW(e.target.value)}
              onBlur={applyCustomSize}
              onKeyDown={(e) => e.key === 'Enter' && applyCustomSize()}
              className="w-16 rounded border border-slate-200 px-1.5 py-1 text-center text-xs text-slate-700"
              aria-label="Ширина холста"
            />
            <span className="text-xs text-slate-400">×</span>
            <input
              type="number"
              min={200}
              max={4096}
              value={customH}
              onChange={(e) => setCustomH(e.target.value)}
              onBlur={applyCustomSize}
              onKeyDown={(e) => e.key === 'Enter' && applyCustomSize()}
              className="w-16 rounded border border-slate-200 px-1.5 py-1 text-center text-xs text-slate-700"
              aria-label="Высота холста"
            />
          </div>
        </div>
      </div>

      {/* Действия справа */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onClearCanvas}
          disabled={itemsCount === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
          title="Очистить холст"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Очистить
        </button>

        <button
          type="button"
          onClick={onSaveProject}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
        >
          <Save className="h-3.5 w-3.5" />
          Сохранить
        </button>

        <button
          type="button"
          onClick={onExportSvg}
          disabled={itemsCount === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" />
          Экспорт SVG
        </button>
      </div>
    </header>
  );
}