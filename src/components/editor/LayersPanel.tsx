'use client';

import React from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  Copy,
  Eye,
  Trash2,
} from 'lucide-react';
import { AppearanceState, Asset, CanvasItem } from '@/types';

export type LayerAction = 'front' | 'back' | 'forward' | 'backward';

interface LayersPanelProps {
  items: CanvasItem[];
  assetsMap: Map<string, Asset>;
  selectedInstanceId: string | null;
  onSelectInstance: (instanceId: string) => void;
  onChangeAppearance: (instanceId: string, appearance: AppearanceState) => void;
  onMoveLayer: (instanceId: string, action: LayerAction) => void;
  onDuplicate: (instanceId: string) => void;
  onDelete: (instanceId: string) => void;
}

export function LayersPanel({
  items,
  assetsMap,
  selectedInstanceId,
  onSelectInstance,
  onChangeAppearance,
  onMoveLayer,
  onDuplicate,
  onDelete,
}: LayersPanelProps) {
  // В панели слоёв верхний слой отображается первым (zIndex по убыванию)
  const orderedLayers = [...items].sort((a, b) => b.zIndex - a.zIndex);
  const selectedItem =
    items.find((i) => i.instanceId === selectedInstanceId) ?? null;
  const selectedAsset = selectedItem
    ? assetsMap.get(selectedItem.assetId)
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      {/* Инспектор выделенного элемента */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Выделенный объект
          </span>
          {selectedItem && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onDuplicate(selectedItem.instanceId)}
                className="rounded p-1 text-slate-500 hover:bg-white hover:text-slate-800"
                title="Дублировать (Ctrl+D)"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onDelete(selectedItem.instanceId)}
                className="rounded p-1 text-slate-500 hover:bg-white hover:text-red-600"
                title="Удалить (Delete)"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {!selectedItem ? (
          <p className="text-xs text-slate-500">
            Кликните по объекту на холсте или в списке слоёв для настройки.
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="text-sm font-semibold text-slate-800">
                {selectedAsset?.title ?? selectedItem.assetId}
              </div>
              <div className="text-[11px] text-slate-500">
                Позиция: {Math.round(selectedItem.x)}, {Math.round(selectedItem.y)} ·
                Поворот: {Math.round(selectedItem.rotation)}°
              </div>
            </div>

            {/* Переключение состояния Главный / Фоновый */}
            <div>
              <span className="mb-1 block text-[11px] font-medium text-slate-600">
                Цветовое состояние
              </span>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-200/70 p-0.5">
                <button
                  type="button"
                  onClick={() =>
                    onChangeAppearance(selectedItem.instanceId, 'main')
                  }
                  className={`rounded-md py-1 text-xs font-medium transition ${
                    selectedItem.appearance === 'main'
                      ? 'bg-white text-indigo-600 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Главный (Цвет)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onChangeAppearance(selectedItem.instanceId, 'background')
                  }
                  className={`rounded-md py-1 text-xs font-medium transition ${
                    selectedItem.appearance === 'background'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Фоновый (BG)
                </button>
              </div>
            </div>

            {/* Порядок слоёв */}
            <div>
              <span className="mb-1 block text-[11px] font-medium text-slate-600">
                Порядок слоёв
              </span>
              <div className="grid grid-cols-4 gap-1">
                <button
                  type="button"
                  onClick={() => onMoveLayer(selectedItem.instanceId, 'front')}
                  className="flex items-center justify-center rounded border border-slate-200 bg-white py-1.5 text-slate-600 hover:bg-slate-50"
                  title="На передний план"
                >
                  <ChevronsUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onMoveLayer(selectedItem.instanceId, 'forward')
                  }
                  className="flex items-center justify-center rounded border border-slate-200 bg-white py-1.5 text-slate-600 hover:bg-slate-50"
                  title="На шаг вперёд"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onMoveLayer(selectedItem.instanceId, 'backward')
                  }
                  className="flex items-center justify-center rounded border border-slate-200 bg-white py-1.5 text-slate-600 hover:bg-slate-50"
                  title="На шаг назад"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onMoveLayer(selectedItem.instanceId, 'back')}
                  className="flex items-center justify-center rounded border border-slate-200 bg-white py-1.5 text-slate-600 hover:bg-slate-50"
                  title="На задний план"
                >
                  <ChevronsDown className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Список всех слоёв */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Слои ({orderedLayers.length})
          </span>
        </div>

        {orderedLayers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
            Холст пуст. Добавьте объекты слева или сгенерируйте сцену.
          </div>
        ) : (
          <ul className="space-y-1">
            {orderedLayers.map((item) => {
              const asset = assetsMap.get(item.assetId);
              const isSelected = item.instanceId === selectedInstanceId;
              return (
                <li key={item.instanceId}>
                  <button
                    type="button"
                    onClick={() => onSelectInstance(item.instanceId)}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition ${
                      isSelected
                        ? 'bg-indigo-50 text-indigo-900 ring-1 ring-indigo-300'
                        : 'bg-white text-slate-700 hover:bg-slate-50 ring-1 ring-slate-200/70'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Eye className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="truncate font-medium">
                        {asset?.title ?? item.assetId}
                      </span>
                    </div>
                    <span
                      className={`ml-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        item.appearance === 'main'
                          ? 'bg-indigo-100 text-indigo-700'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {item.appearance === 'main' ? 'Main' : 'BG'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}