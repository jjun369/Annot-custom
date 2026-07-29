import type { AIProvider } from '@/types';
import type { ProviderModel } from './types';

export const AUTO_MODEL_ID = 'auto';

const LEGACY_IMPLICIT_DEFAULTS = new Set([
  'gpt-5.4-mini',
]);

export function isLegacyImplicitModel(model: string | null | undefined): boolean {
  const normalized = model?.trim().toLowerCase();
  return !normalized || LEGACY_IMPLICIT_DEFAULTS.has(normalized);
}

export function isAutoModel(model: string | null | undefined): boolean {
  return !model?.trim() || model.trim().toLowerCase() === AUTO_MODEL_ID;
}

export function normalizeModelPreference(model: string | null | undefined): string {
  const normalized = model?.trim();
  if (!normalized || isLegacyImplicitModel(normalized)) {
    return AUTO_MODEL_ID;
  }

  return normalized;
}

export function getAutoModelLabel(provider: AIProvider): string {
  return provider === 'claude'
    ? '자동 (Claude 권장 모델)'
    : '자동 (Codex 권장 모델)';
}

export function withAutoModel(provider: AIProvider, models: ProviderModel[]): ProviderModel[] {
  const recommendedModel = models[0];
  return [
    {
      id: AUTO_MODEL_ID,
      owned_by: provider,
      created: 0,
      display_name: getAutoModelLabel(provider),
      default_reasoning_level: recommendedModel?.default_reasoning_level,
      supported_reasoning_levels: recommendedModel?.supported_reasoning_levels,
    },
    ...models.filter((model) => model.id !== AUTO_MODEL_ID),
  ];
}
