'use client';

import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActiveSelection, Canvas, FabricObject, util } from 'fabric';
import {
  AppearanceState,
  Asset,
  CanvasItem,
  ColorScheme,
  CompositionDocument,
  DetailProfile,
} from '@/types';
import {
  createFabricGroupFromItem,
  exportCanvasToSvg,
  extractTransformFromFabricObject,
  FabricComposerObject,
  recolorCanvas,
} from '@/lib/fabric';

export interface CanvasEditorHandle {
  exportSvg: () => string | null;
}

interface CanvasEditorProps {
  doc: CompositionDocument;
  assetsMap: Map<string, Asset>;
  activeScheme: ColorScheme;
  selectedInstanceId: string | null;
  onSelectInstance: (instanceId: string | null) => void;
  onUpdateItems: (
    updates: Array<
      { instanceId: string } & Partial<
        Pick<CanvasItem, 'x' | 'y' | 'scale' | 'rotation'>
      >
    >
  ) => void;
  onDuplicateSelected: () => void;
  onDeleteSelected: () => void;
}

interface RenderedMeta {
  assetId: string;
  appearance: AppearanceState;
  detailProfile: DetailProfile;
}

export const CanvasEditor = React.forwardRef<
  CanvasEditorHandle,
  CanvasEditorProps
>(function CanvasEditor(
  {
    doc,
    assetsMap,
    activeScheme,
    selectedInstanceId,
    onSelectInstance,
    onUpdateItems,
    onDuplicateSelected,
    onDeleteSelected,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<Canvas | null>(null);
  const renderedMetaRef = useRef<Map<string, RenderedMeta>>(new Map());
  const syncInProgressRef = useRef(false);

  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });

  // Актуальные колбэки в ref, чтобы не переподписывать события Fabric на каждый рендер
  const callbacksRef = useRef({
    onSelectInstance,
    onUpdateItems,
    onDuplicateSelected,
    onDeleteSelected,
  });
  callbacksRef.current = {
    onSelectInstance,
    onUpdateItems,
    onDuplicateSelected,
    onDeleteSelected,
  };

  const docRef = useRef(doc);
  docRef.current = doc;

  useImperativeHandle(ref, () => ({
    exportSvg: () => {
      if (!fabricRef.current) return null;
      return exportCanvasToSvg(fabricRef.current, docRef.current.artboard);
    },
  }));

  // 1. Отслеживаем размер контейнера для автоматического zoom-to-fit
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setContainerSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 2. Инициализируем Fabric.js v7 Canvas
  useEffect(() => {
    const el = canvasElRef.current;
    if (!el) return;

    const canvas = new Canvas(el, {
      preserveObjectStacking: true,
      selection: true,
      uniformScaling: true,
      backgroundColor: '',
    });

    fabricRef.current = canvas;
    const metaMap = renderedMetaRef.current;

    const handleSelection = () => {
      if (syncInProgressRef.current) return;
      const active = canvas.getActiveObject();
      if (!active) {
        callbacksRef.current.onSelectInstance(null);
        return;
      }
      if (active instanceof ActiveSelection) {
        callbacksRef.current.onSelectInstance(null);
        return;
      }
      const id = (active as FabricComposerObject).__instanceId ?? null;
      callbacksRef.current.onSelectInstance(id);
    };

    const handleRotating = (opt: { target?: FabricObject; e?: Event }) => {
      const target = opt.target;
      const ev = opt.e;
      if (!target || !ev) return;
      if ('shiftKey' in ev && (ev as MouseEvent).shiftKey) {
        const currentAngle = target.angle ?? 0;
        target.angle = Math.round(currentAngle / 15) * 15;
      }
    };

    const handleModified = (opt: { target?: FabricObject }) => {
      if (syncInProgressRef.current || !opt.target) return;
      const target = opt.target;

      if (target instanceof ActiveSelection) {
        const updates: Array<
          { instanceId: string } & Pick<
            CanvasItem,
            'x' | 'y' | 'scale' | 'rotation'
          >
        > = [];

        for (const child of target.getObjects()) {
          const composerObj = child as FabricComposerObject;
          if (!composerObj.__instanceId) continue;

          const matrix = composerObj.calcTransformMatrix();
          const decomposed = util.qrDecompose(matrix);
          const norm = composerObj.__normalizationFactor || 1;

          updates.push({
            instanceId: composerObj.__instanceId,
            x: Math.round(decomposed.translateX * 100) / 100,
            y: Math.round(decomposed.translateY * 100) / 100,
            scale: Math.round((decomposed.scaleX / norm) * 10000) / 10000,
            rotation:
              Math.round((((decomposed.angle % 360) + 360) % 360) * 100) / 100,
          });
        }
        if (updates.length > 0) {
          callbacksRef.current.onUpdateItems(updates);
        }
        return;
      }

      const composerObj = target as FabricComposerObject;
      if (composerObj.__instanceId) {
        const transform = extractTransformFromFabricObject(composerObj);
        callbacksRef.current.onUpdateItems([
          { instanceId: composerObj.__instanceId, ...transform },
        ]);
      }
    };

    canvas.on('selection:created', handleSelection);
    canvas.on('selection:updated', handleSelection);
    canvas.on('selection:cleared', () => {
      if (!syncInProgressRef.current) {
        callbacksRef.current.onSelectInstance(null);
      }
    });
    canvas.on('object:rotating', handleRotating);
    canvas.on('object:modified', handleModified);

    return () => {
      metaMap.clear();
      canvas.dispose();
      fabricRef.current = null;
    };
  }, []);

  // 3. Обновляем размер вьюпорта и zoom-to-fit при изменении Artboard или окна
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const padding = 48;
    const availW = Math.max(containerSize.width - padding, 200);
    const availH = Math.max(containerSize.height - padding, 200);

    const fitZoom = Math.min(
      availW / doc.artboard.width,
      availH / doc.artboard.height,
      1.2
    );

    canvas.setDimensions({
      width: Math.round(doc.artboard.width * fitZoom),
      height: Math.round(doc.artboard.height * fitZoom),
    });
    canvas.setZoom(fitZoom);
    canvas.requestRenderAll();
  }, [containerSize, doc.artboard.width, doc.artboard.height]);

  // 4. Синхронизация объектов CompositionDocument <-> Fabric Canvas
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    let cancelled = false;

    async function syncScene() {
      if (!canvas) return;
      syncInProgressRef.current = true;

      try {
        const sortedItems = [...doc.items].sort((a, b) => a.zIndex - b.zIndex);
        const targetIds = new Set(sortedItems.map((i) => i.instanceId));

        // Удаляем объекты, которых больше нет в документе
        for (const obj of [...canvas.getObjects()]) {
          const composerObj = obj as FabricComposerObject;
          if (!composerObj.__instanceId || !targetIds.has(composerObj.__instanceId)) {
            canvas.remove(composerObj);
            if (composerObj.__instanceId) {
              renderedMetaRef.current.delete(composerObj.__instanceId);
            }
          }
        }

        // Индексируем оставшиеся объекты
        const existingMap = new Map<string, FabricComposerObject>();
        for (const obj of canvas.getObjects()) {
          const cObj = obj as FabricComposerObject;
          if (cObj.__instanceId) {
            existingMap.set(cObj.__instanceId, cObj);
          }
        }

        // Добавляем новые или пересоздаём при смене appearance / detailProfile
        for (const item of sortedItems) {
          if (cancelled) return;
          const asset = assetsMap.get(item.assetId);
          if (!asset) continue;

          const prevMeta = renderedMetaRef.current.get(item.instanceId);
          const existingObj = existingMap.get(item.instanceId);

          const needsRebuild =
            !existingObj ||
            !prevMeta ||
            prevMeta.assetId !== item.assetId ||
            prevMeta.appearance !== item.appearance ||
            prevMeta.detailProfile !== doc.detailProfile;

          if (needsRebuild) {
            if (existingObj) {
              canvas.remove(existingObj);
            }

            const newGroup = await createFabricGroupFromItem(
              item,
              asset,
              doc.detailProfile,
              activeScheme
            );
            if (cancelled) return;

            canvas.add(newGroup);
            existingMap.set(item.instanceId, newGroup);
            renderedMetaRef.current.set(item.instanceId, {
              assetId: item.assetId,
              appearance: item.appearance,
              detailProfile: doc.detailProfile,
            });
          } else if (existingObj) {
            // Мягкое обновление трансформаций без пересоздания SVG
            const norm = existingObj.__normalizationFactor || 1;
            const targetScale = item.scale * norm;
            const eps = 0.01;
            const needsTransformUpdate =
              Math.abs((existingObj.left ?? 0) - item.x) > eps ||
              Math.abs((existingObj.top ?? 0) - item.y) > eps ||
              Math.abs((existingObj.scaleX ?? 1) - targetScale) > 0.0005 ||
              Math.abs((existingObj.angle ?? 0) - item.rotation) > eps;

            if (needsTransformUpdate) {
              existingObj.set({
                left: item.x,
                top: item.y,
                scaleX: targetScale,
                scaleY: targetScale,
                angle: item.rotation,
              });
              existingObj.setCoords();
            }
          }
        }

        // Выставляем порядок слоёв согласно sortedItems
        sortedItems.forEach((item, idx) => {
          const obj = existingMap.get(item.instanceId);
          if (obj) {
            canvas.moveObjectTo(obj, idx);
          }
        });

        // Восстанавливаем выделение, если оно пришло из панели слоёв
        if (selectedInstanceId) {
          const toSelect = existingMap.get(selectedInstanceId);
          const currentActive = canvas.getActiveObject() as
            | FabricComposerObject
            | undefined;
          if (toSelect && currentActive?.__instanceId !== selectedInstanceId) {
            canvas.setActiveObject(toSelect);
          }
        } else if (canvas.getActiveObject() && !(canvas.getActiveObject() instanceof ActiveSelection)) {
          canvas.discardActiveObject();
        }

        canvas.requestRenderAll();
      } finally {
        syncInProgressRef.current = false;
      }
    }

    syncScene();
    return () => {
      cancelled = true;
    };
  }, [doc.items, doc.detailProfile, assetsMap, activeScheme, selectedInstanceId]);

  // 5. Мгновенная перекраска при смене палитры без пересоздания объектов
  // 5. Мгновенная перекраска при смене палитры и фона холста
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.backgroundColor =
      doc.backgroundFill === 'none'
        ? ''
        : activeScheme.background[doc.backgroundFill];
    recolorCanvas(canvas, activeScheme);
  }, [activeScheme, doc.backgroundFill]);

  // 6. Горячие клавиши: Ctrl+D (дублировать) и Delete/Backspace (удалить)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (
        activeTag === 'input' ||
        activeTag === 'textarea' ||
        activeTag === 'select'
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        callbacksRef.current.onDuplicateSelected();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        callbacksRef.current.onDeleteSelected();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative flex flex-1 items-center justify-center overflow-hidden bg-slate-100 p-6"
    >
      {/* Шахматная подложка для визуализации прозрачного Artboard */}
      <div
        className="relative rounded-sm shadow-lg ring-1 ring-slate-300"
        style={{
          backgroundImage:
            'linear-gradient(45deg, #f1f5f9 25%, transparent 25%), linear-gradient(-45deg, #f1f5f9 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f1f5f9 75%), linear-gradient(-45deg, transparent 75%, #f1f5f9 75%)',
          backgroundSize: '20px 20px',
          backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
          backgroundColor: '#ffffff',
        }}
      >
        <canvas ref={canvasElRef} />
      </div>

      {/* Индикатор размеров Artboard в углу */}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-white/90 px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm ring-1 ring-slate-200">
        Artboard: {doc.artboard.width} × {doc.artboard.height} px · Профиль:{' '}
        <span className="font-semibold text-indigo-600">{doc.detailProfile}</span>
      </div>
    </div>
  );
});