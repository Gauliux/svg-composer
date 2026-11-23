'use client';

import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader2, Settings, Wand2 } from 'lucide-react';
import { AiClientConfig, Asset } from '@/types';
import { AiComposeResult, generateCompositionByMetaphor } from '@/lib/ollama';

const STORAGE_KEY = 'svg_composer_ai_config';

const DEFAULT_CONFIG: AiClientConfig = {
  useCustomConfig: false,
  provider: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen2.5:7b',
  apiKey: '',
  temperature: 0.2,
};

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
  const [showSettings, setShowSettings] = useState(false);
  const [aiConfig, setAiConfig] = useState<AiClientConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        setAiConfig({ ...DEFAULT_CONFIG, ...JSON.parse(saved) });
      }
    } catch {
      // игнорируем повреждённый localStorage
    }
  }, []);

  const updateConfig = (patch: Partial<AiClientConfig>) => {
    setAiConfig((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // игнорируем
      }
      return next;
    });
  };

  const applyPreset = (preset: 'ollama' | 'groq' | 'openai') => {
    if (preset === 'ollama') {
      updateConfig({
        useCustomConfig: true,
        provider: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'qwen2.5:7b',
      });
    } else if (preset === 'groq') {
      updateConfig({
        useCustomConfig: true,
        provider: 'openai',
        baseUrl: 'https://api.groq.com/openai/v1',
        model: 'llama-3.1-8b-instant',
      });
    } else {
      updateConfig({
        useCustomConfig: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
      });
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || assets.length === 0) return;

    setLoading(true);
    setError(null);
    try {
      const result = await generateCompositionByMetaphor(
        prompt.trim(),
        assets,
        aiConfig
      );
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
      className="space-y-2.5 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-indigo-950">
          <Wand2 className="h-3.5 w-3.5 text-indigo-600" />
          Сборка по метафоре (AI)
        </span>
        <div className="flex items-center gap-1.5">
          {lastModel && (
            <span className="max-w-[115px] truncate text-[10px] font-medium text-indigo-600">
              {lastModel}
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            className={`rounded p-1 transition ${
              showSettings || aiConfig.useCustomConfig
                ? 'bg-indigo-100 text-indigo-700'
                : 'text-slate-500 hover:bg-white hover:text-slate-800'
            }`}
            title="Настройки подключения AI (Ollama / OpenAI / API ключ)"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Панель настроек AI */}
      {showSettings && (
        <div className="space-y-2 rounded-lg border border-indigo-200 bg-white p-2.5 text-[11px]">
          <label className="flex items-center gap-2 font-medium text-slate-700">
            <input
              type="checkbox"
              checked={aiConfig.useCustomConfig}
              onChange={(e) =>
                updateConfig({ useCustomConfig: e.target.checked })
              }
              className="rounded border-slate-300 text-indigo-600"
            />
            Переопределить настройки (.env)
          </label>

          {!aiConfig.useCustomConfig ? (
            <p className="text-[10px] text-slate-500">
              Используются настройки сервера из <code>.env.local</code> (по
              умолчанию локальная Ollama).
            </p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() => applyPreset('ollama')}
                  className="rounded border border-slate-200 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  Ollama
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('groq')}
                  className="rounded border border-slate-200 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  Groq (Free)
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('openai')}
                  className="rounded border border-slate-200 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  OpenAI
                </button>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <select
                  value={aiConfig.provider}
                  onChange={(e) =>
                    updateConfig({
                      provider: e.target.value as 'ollama' | 'openai',
                    })
                  }
                  className="rounded border border-slate-200 px-1.5 py-1 text-[11px]"
                >
                  <option value="ollama">Ollama</option>
                  <option value="openai">OpenAI-совм.</option>
                </select>
                <input
                  type="text"
                  value={aiConfig.model}
                  onChange={(e) => updateConfig({ model: e.target.value })}
                  placeholder="Модель"
                  className="rounded border border-slate-200 px-1.5 py-1 text-[11px]"
                />
              </div>

              <input
                type="text"
                value={aiConfig.baseUrl}
                onChange={(e) => updateConfig({ baseUrl: e.target.value })}
                placeholder="Base URL"
                className="w-full rounded border border-slate-200 px-2 py-1 text-[11px]"
              />

              {aiConfig.provider === 'openai' && (
                <input
                  type="password"
                  value={aiConfig.apiKey}
                  onChange={(e) => updateConfig({ apiKey: e.target.value })}
                  placeholder="API ключ (хранится только в браузере)"
                  className="w-full rounded border border-slate-200 px-2 py-1 text-[11px]"
                />
              )}

              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-500">
                  Temperature: {aiConfig.temperature}
                </span>
                <input
                  type="range"
                  min={0}
                  max={0.8}
                  step={0.1}
                  value={aiConfig.temperature}
                  onChange={(e) =>
                    updateConfig({ temperature: Number(e.target.value) })
                  }
                  className="w-24"
                />
              </div>
            </div>
          )}
        </div>
      )}

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