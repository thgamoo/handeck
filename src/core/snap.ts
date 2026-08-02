/**
 * 정렬 스냅.
 *
 * 끌다가 «거의 맞는» 위치에 오면 딱 붙여준다. 눈대중으로 0.3mm 어긋나는 걸 막는다.
 *
 * 붙는 기준선:
 *   - 조각 자체 — 가장자리 · 재단선 · 한가운데
 *   - 다른 레이어 — 왼쪽/가운데/오른쪽, 위/가운데/아래
 *
 * 임계값은 mm 가 아니라 **화면 픽셀** 로 잡는다. 확대해서 볼 때 스냅이 과하게
 * 걸리면 미세 조정이 불가능해지기 때문이다.
 */

import type { Layer, PieceSize } from './model.ts'

export interface SnapTarget {
  /** 기준선 위치 (mm) */
  at: number
  /**
   * 가이드선 종류.
   *   piece 계열(edge/trim/center) = 조각 자체 기준  -> 화면에 **실선**
   *   layer                        = 다른 레이어 기준 -> **점선** + 이름 표시
   * 둘을 눈으로 바로 구분할 수 있어야 «지금 뭐에 맞춘 건지» 를 안다.
   */
  kind: 'edge' | 'trim' | 'center' | 'layer'
  /** layer 일 때 어느 레이어인지 */
  label?: string
  /** layer 일 때 그 레이어의 다른 축 범위 (가이드선을 그 구간에만 그린다) */
  span?: { from: number; to: number }
}

export interface SnapResult {
  x: number
  y: number
  /** 화면에 그릴 세로 가이드선 (mm) */
  guidesX: SnapTarget[]
  /** 가로 가이드선 (mm) */
  guidesY: SnapTarget[]
}

/**
 * 가장자리에서 이만큼 안쪽 (mm) 에 붙는 자리를 하나 둔다.
 *
 * 안내선으로 «항상» 그려두지는 않는다 (판의 크기가 곧 카드라 선이 하나 더
 * 있어봐야 알려주는 게 없다). 다만 끌어다 놓을 때는 여백을 맞추는 일이 잦아
 * **끄는 동안에만** 이 자리가 나타난다.
 */
const INSET = 3

function pieceTargets(size: PieceSize, axis: 'x' | 'y'): SnapTarget[] {
  const len = axis === 'x' ? size.w : size.h
  return [
    { at: 0, kind: 'edge' },
    { at: INSET, kind: 'trim' },
    { at: len / 2, kind: 'center' },
    { at: len - INSET, kind: 'trim' },
    { at: len, kind: 'edge' },
  ]
}

function layerTargets(layers: Layer[], skipId: string, axis: 'x' | 'y'): SnapTarget[] {
  const out: SnapTarget[] = []
  for (const l of layers) {
    if (l.id === skipId || l.hidden) continue
    const start = axis === 'x' ? l.x : l.y
    const size = axis === 'x' ? l.w : l.h
    // 반대 축 범위 — 가이드선을 그 레이어가 실제로 있는 구간에만 그리기 위해
    const span =
      axis === 'x' ? { from: l.y, to: l.y + l.h } : { from: l.x, to: l.x + l.w }
    out.push(
      { at: start, kind: 'layer', label: l.name, span },
      { at: start + size / 2, kind: 'layer', label: l.name, span },
      { at: start + size, kind: 'layer', label: l.name, span }
    )
  }
  return out
}

/** 한 축에 대해 가장 가까운 스냅을 찾는다. */
function snapAxis(
  start: number,
  size: number,
  targets: SnapTarget[],
  tol: number
): { delta: number; hits: SnapTarget[] } {
  // 움직이는 쪽의 세 기준: 앞 모서리 · 가운데 · 뒤 모서리
  const edges = [start, start + size / 2, start + size]
  let best: { delta: number; dist: number } | null = null

  for (const e of edges) {
    for (const t of targets) {
      const d = t.at - e
      const dist = Math.abs(d)
      if (dist > tol) continue
      if (!best || dist < best.dist) best = { delta: d, dist }
    }
  }
  if (!best) return { delta: 0, hits: [] }

  // 실제로 붙은 기준선들을 모아 가이드로 그린다.
  // 같은 위치에 여러 기준선이 겹치는 일이 흔하다(가운데 정렬된 레이어들).
  // 위치별로 하나만 남기고, 의미가 강한 종류를 우선한다.
  const moved = edges.map((e) => e + best!.delta)
  const RANK: Record<SnapTarget['kind'], number> = { center: 0, trim: 1, edge: 2, layer: 3 }
  const byPos = new Map<number, SnapTarget>()
  for (const t of targets) {
    if (!moved.some((e) => Math.abs(e - t.at) < 0.01)) continue
    const key = Math.round(t.at * 100)
    const cur = byPos.get(key)
    if (!cur || RANK[t.kind] < RANK[cur.kind]) byPos.set(key, t)
  }
  return { delta: best.delta, hits: [...byPos.values()] }
}

export function snapMove(
  proposed: { x: number; y: number },
  layer: Layer,
  all: Layer[],
  size: PieceSize,
  /** 화면 1mm 의 px. 임계값을 px 기준으로 잡기 위해 필요하다. */
  mmPx: number,
  /** 스냅 임계값 (화면 px) */
  thresholdPx = 6
): SnapResult {
  const tol = thresholdPx / mmPx

  const tx = [...pieceTargets(size, 'x'), ...layerTargets(all, layer.id, 'x')]
  const ty = [...pieceTargets(size, 'y'), ...layerTargets(all, layer.id, 'y')]

  const sx = snapAxis(proposed.x, layer.w, tx, tol)
  const sy = snapAxis(proposed.y, layer.h, ty, tol)

  return {
    x: proposed.x + sx.delta,
    y: proposed.y + sy.delta,
    guidesX: sx.hits,
    guidesY: sy.hits,
  }
}

/** 크기 조절 중인 모서리를 스냅한다. */
export function snapEdge(
  value: number,
  axis: 'x' | 'y',
  layer: Layer,
  all: Layer[],
  size: PieceSize,
  mmPx: number,
  thresholdPx = 6
): { value: number; hits: SnapTarget[] } {
  const tol = thresholdPx / mmPx
  const targets =
    axis === 'x'
      ? [...pieceTargets(size, 'x'), ...layerTargets(all, layer.id, 'x')]
      : [...pieceTargets(size, 'y'), ...layerTargets(all, layer.id, 'y')]

  let best: SnapTarget | null = null
  for (const t of targets) {
    const d = Math.abs(t.at - value)
    if (d > tol) continue
    if (!best || d < Math.abs(best.at - value)) best = t
  }
  return best ? { value: best.at, hits: [best] } : { value, hits: [] }
}
