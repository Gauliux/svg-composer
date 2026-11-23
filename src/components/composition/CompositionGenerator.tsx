'use client';

import React, { useState } from 'react';
import { AlertCircle, Loader2, Wand2 } from 'lucide-react';
import { Asset } from '@/types';
import { AiComposeResult, generateCompositionByMetaphor } from '@/lib/ollama';

const EXAMPLE_PROMPTS = [
  'Безопасность данных и цифровые технологии',
  'Творческое обучение и чтение дома',
  'Финансовое планирование и идеи',
];

interface CompositionGeneratorProps {
  assets: Asset[];
  onApplyAiComposition: (result: AiComposeResult) => void;
}

export function CompositionGenerator({
  assets,
  onApplyAiComposition,
}: CompositionGeneratorProps) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastModel, setLastModel] = useState<string | null>(null);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || assets.length === 0) return;

    setLoading(true);
    setError(null);
    try {
      const result = await generateCompositionByMetaphor(prompt.trim(), assets);
      setLastModel(result.model);
      onApplyAiComposition(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Ошибка генерации композиции'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleGenerate}
      className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 space-y-2.5"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-indigo-950">
          <Wand2 className="h-3.5 w-3.5 text-indigo-600" />
          Сборка по метафоре (AI)
        </span>
        {lastModel && (
          <span className="text-[10px] font-medium text-indigo-600">
            {lastModel}
          </span>
        )}
      </div>

      <textarea
        rows={2}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Опишите тему или заголовок иллюстрации..."
        className="w-full resize-none rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
      />

      <div className="flex flex-wrap gap-1">
        {EXAMPLE_PROMPTS.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setPrompt(ex)}
            className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-600 ring-1 ring-slate-200 hover:text-indigo-700"
          >
            {ex}
          </button>
        ))}
      </div>

      <button
        type="submit"
        disabled={loading || !prompt.trim() || assets.length === 0}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Подбор компонентов...
          </>
        ) : (
          <>
            <Wand2 className="h-3.5 w-3.5" />
            Собрать композицию
          </>
        )}
      </button>

      {error && (
        <div className="flex items-start gap-1.5 rounded-lg bg-red-50 p-2 text-[11px] text-red-700 ring-1 ring-red-200">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </form>
  );
}