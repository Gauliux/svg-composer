'use client';

import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  Package,
  RefreshCw,
  X,
} from 'lucide-react';
import { ImportReport } from '@/types';

interface AssetImporterProps {
  onImportZip: (file: File) => Promise<ImportReport>;
  onImportDirectory: (files: FileList) => Promise<ImportReport>;
  onReloadDemo: () => Promise<ImportReport>;
}

export function AssetImporter({
  onImportZip,
  onImportDirectory,
  onReloadDemo,
}: AssetImporterProps) {
  const zipInputRef = useRef<HTMLInputElement | null>(null);
  const dirInputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);

  const runImport = async (fn: () => Promise<ImportReport>) => {
    setLoading(true);
    try {
      const res = await fn();
      setReport(res);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          disabled={loading}
          onClick={() => zipInputRef.current?.click()}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <Package className="h-3.5 w-3.5 text-indigo-600" />
          Импорт ZIP
        </button>

        <button
          type="button"
          disabled={loading}
          onClick={() => dirInputRef.current?.click()}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <FolderOpen className="h-3.5 w-3.5 text-indigo-600" />
          Папка
        </button>
      </div>

      <button
        type="button"
        disabled={loading}
        onClick={() => runImport(onReloadDemo)}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        Загрузить демо-библиотеку
      </button>

      <input
        ref={zipInputRef}
        type="file"
        accept=".zip"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) runImport(() => onImportZip(file));
          e.target.value = '';
        }}
      />

      <input
        ref={dirInputRef}
        type="file"
        multiple
        className="hidden"
        {...({ webkitdirectory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) {
            runImport(() => onImportDirectory(files));
          }
          e.target.value = '';
        }}
      />

      {/* Отчёт импорта */}
      {report && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-semibold text-slate-800">
              {report.errors.length === 0 ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              )}
              Отчёт импорта
            </span>
            <button
              type="button"
              onClick={() => setReport(null)}
              className="rounded p-0.5 text-slate-400 hover:text-slate-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="space-y-1 text-slate-600">
            <div>Компонентов: {report.assetsCount}</div>
            <div>SVG-вариантов: {report.variantsCount}</div>
            {report.unknownColors.length > 0 && (
              <div className="text-amber-700">
                Неизвестных цветов: {report.unknownColors.length}
              </div>
            )}
          </div>

          {report.errors.length > 0 && (
            <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto rounded bg-red-50 p-2 text-[11px] text-red-700">
              {report.errors.map((err, i) => (
                <li key={i}>• {err.message}</li>
              ))}
            </ul>
          )}

          {report.warnings.length > 0 && (
            <ul className="mt-2 max-h-24 space-y-1 overflow-y-auto rounded bg-amber-50 p-2 text-[11px] text-amber-800">
              {report.warnings.map((w, i) => (
                <li key={i}>• {w.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}