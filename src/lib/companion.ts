import type {
  CompanionBodyShape,
  CompanionEars,
  CompanionExpression,
  CompanionMotion,
  CompanionSize,
  CompanionTail,
  CompanionVisualConfig,
  Persona,
} from '../types'

const HEX_COLOR = /^#[0-9a-f]{6}$/i

export const defaultCompanionVisualConfig: CompanionVisualConfig = {
  version: 1,
  bodyShape: 'bean',
  palette: {
    body: '#F8FAFC',
    accent: '#7B6DFF',
    eye: '#111827',
    cheek: '#FFB3C7',
  },
  features: {
    ears: 'soft',
    antenna: false,
    tail: 'none',
    glasses: false,
  },
  expression: 'curious',
  motion: 'gentle',
  size: 'medium',
}

function option<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback
}

function color(value: unknown, fallback: string) {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value.toUpperCase() : fallback
}

function flag(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

export function normalizeCompanionVisualConfig(value: unknown): CompanionVisualConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const palette = raw.palette && typeof raw.palette === 'object' ? (raw.palette as Record<string, unknown>) : {}
  const features = raw.features && typeof raw.features === 'object' ? (raw.features as Record<string, unknown>) : {}
  const fallback = defaultCompanionVisualConfig

  return {
    version: 1,
    bodyShape: option<CompanionBodyShape>(raw.bodyShape, ['bean', 'orb', 'capsule'], fallback.bodyShape),
    palette: {
      body: color(palette.body, fallback.palette.body),
      accent: color(palette.accent, fallback.palette.accent),
      eye: color(palette.eye, fallback.palette.eye),
      cheek: color(palette.cheek, fallback.palette.cheek),
    },
    features: {
      ears: option<CompanionEars>(features.ears, ['none', 'soft', 'pointed'], fallback.features.ears),
      antenna: flag(features.antenna, fallback.features.antenna),
      tail: option<CompanionTail>(features.tail, ['none', 'curl', 'spark'], fallback.features.tail),
      glasses: flag(features.glasses, fallback.features.glasses),
    },
    expression: option<CompanionExpression>(raw.expression, ['curious', 'happy', 'focused'], fallback.expression),
    motion: option<CompanionMotion>(raw.motion, ['still', 'gentle', 'lively'], fallback.motion),
    size: option<CompanionSize>(raw.size, ['small', 'medium', 'large'], fallback.size),
  }
}

export function normalizePersona(row: Record<string, unknown>): Persona {
  const persona = row as unknown as Persona
  return {
    ...persona,
    avatar_url: (row.avatar_url as string | null | undefined) ?? null,
    default_model: (row.default_model as string | null | undefined) ?? null,
    visual_config: normalizeCompanionVisualConfig(row.visual_config),
    companion_enabled: row.companion_enabled !== false,
  }
}
