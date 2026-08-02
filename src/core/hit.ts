/**
 * 히트 테스트 — «누른 지점에 실제로 뭔가 칠해져 있는가».
 *
 * 조작 상자(사각형)로 판정하면 큰 배경 그림이나 넓은 글자 상자가
 * 그 아래 있는 걸 전부 덮어버려서 «보이는 걸 눌렀는데 딴 게 잡힌다» 가 된다.
 * 그래서 상자가 아니라 **칠해진 화소**를 기준으로 고른다.
 *
 * 여기는 DOM 을 모른다. 알파맵과 글자 줄 상자는 바깥에서 넣어준다(`Probe`).
 * 모르는 건 **불투명으로 본다** — 판정이 애매할 때 예전처럼 상자로 잡히는 게
 * 아무것도 안 잡히는 것보다 낫다.
 *
 * 좌표는 전부 mm, 조각(판) 좌상단 기준.
 */

import { type ImageLayer, type Instance, type Layer, resolveAsset, resolveText } from './model.ts'

/** 이미지 한 장의 알파 채널만 (축소본). `a[y * w + x]` = 0~255 */
export interface AlphaMap {
  w: number
  h: number
  a: Uint8Array
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

export interface Probe {
  /** 에셋의 알파맵. 아직 못 읽었으면 undefined — 상자 전체를 불투명으로 본다. */
  alpha?: (assetId: string) => AlphaMap | undefined
  /** 글자가 실제로 차지하는 줄 상자들. **레이어 좌상단 기준 mm.** */
  textBoxes?: (layerId: string) => Box[] | undefined
}

/** 이보다 옅으면 «안 칠해진 것» 으로 본다 */
const MIN_ALPHA = 0.03

/** 얇은 선도 집을 수 있게 하는 최소 잡이 폭 (mm) */
const MIN_GRAB = 0.8

// ---------------------------------------------------------------------------
// 색

/**
 * CSS 색 문자열의 알파. 못 읽는 표기는 **1(불투명)** 로 본다.
 * 우리가 만들어내는 색(`#rrggbb`, `rgba()`)과 사용자가 직접 적는 색만 다루면 된다.
 */
export function colorAlpha(c?: string): number {
  if (!c) return 0
  const s = c.trim().toLowerCase()
  if (!s || s === 'transparent' || s === 'none') return 0

  if (s.startsWith('#')) {
    const h = s.slice(1)
    if (h.length === 4) return parseInt(h[3]! + h[3]!, 16) / 255
    if (h.length === 8) return parseInt(h.slice(6, 8), 16) / 255
    return 1
  }

  const m = /^(?:rgba?|hsla?)\((.*)\)$/.exec(s)
  if (!m) return 1
  const body = m[1]!
  // 두 가지 표기: `rgba(0,0,0,.5)` 와 `rgb(0 0 0 / 50%)`
  const tail = body.includes('/')
    ? body.slice(body.indexOf('/') + 1)
    : (body.split(',')[3] ?? '')
  const t = tail.trim()
  if (!t) return 1
  const v = t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t)
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1
}

// ---------------------------------------------------------------------------
// 도형

/** 둥근 모서리를 감안한 상자 안쪽 판정. 모서리 바깥의 «귀» 는 빈 곳이다. */
function inRoundedRect(px: number, py: number, w: number, h: number, radius?: number): boolean {
  if (px < 0 || py < 0 || px > w || py > h) return false
  const r = Math.max(0, Math.min(radius ?? 0, w / 2, h / 2))
  if (r <= 0) return true
  const cx = px < r ? r : px > w - r ? w - r : px
  const cy = py < r ? r : py > h - r ? h - r : py
  const dx = px - cx
  const dy = py - cy
  return dx * dx + dy * dy <= r * r
}

// ---------------------------------------------------------------------------
// 그늘(gradient)

/** `'rgba(0,0,0,.6) 40%'` -> 색과 위치. 괄호 안의 공백은 건드리지 않는다. */
function splitStop(stop: string): { color: string; pos?: number } {
  const s = stop.trim()
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ' ' && depth === 0) {
      const rest = s.slice(i + 1).trim()
      const pos = rest.endsWith('%') ? parseFloat(rest) / 100 : NaN
      return { color: s.slice(0, i), pos: Number.isFinite(pos) ? pos : undefined }
    }
  }
  return { color: s }
}

/**
 * 그늘 축 위의 위치(0~1).
 *
 * CSS 각도 규약: 0deg = 위쪽 방향, 시계 방향.
 * 모서리 키워드(`to bottom right`)는 정사각형이 아니면 CSS 와 정확히 같지 않지만
 * 클릭 판정에는 충분하다.
 */
const DIRS: Record<string, number> = {
  'to top': 0,
  'to right': 90,
  'to bottom': 180,
  'to left': 270,
  'to top right': 45,
  'to right top': 45,
  'to bottom right': 135,
  'to right bottom': 135,
  'to bottom left': 225,
  'to left bottom': 225,
  'to top left': 315,
  'to left top': 315,
}

function gradientT(direction: string | undefined, px: number, py: number, w: number, h: number): number {
  const d = (direction ?? 'to bottom').trim().toLowerCase()
  const deg = /^-?[\d.]+deg$/.test(d) ? parseFloat(d) : (DIRS[d] ?? 180)
  const rad = (deg * Math.PI) / 180
  const ux = Math.sin(rad)
  const uy = -Math.cos(rad)
  const len = Math.abs(w * ux) + Math.abs(h * uy)
  if (len <= 0) return 0
  const t = ((px - w / 2) * ux + (py - h / 2) * uy) / len + 0.5
  return Math.min(1, Math.max(0, t))
}

/** 그늘의 그 지점 알파. 아래로 갈수록 짙어지는 그늘은 **위쪽이 빈 곳**이 된다. */
export function gradientAlpha(stops: string[], direction: string | undefined, px: number, py: number, w: number, h: number): number {
  // 빈 줄은 그릴 때도 무시된다 (`gradientCss`). 판정도 같아야 한다.
  const list = stops.map((s) => s.trim()).filter(Boolean)
  if (list.length === 0) return 0
  const parsed = list.map(splitStop)
  const alphas = parsed.map((s) => colorAlpha(s.color))
  if (parsed.length === 1) return alphas[0]!

  // 위치가 안 적힌 단계는 양옆의 아는 위치 사이에 고르게 편다
  const pos: number[] = parsed.map((s) => s.pos ?? NaN)
  if (!Number.isFinite(pos[0]!)) pos[0] = 0
  if (!Number.isFinite(pos[pos.length - 1]!)) pos[pos.length - 1] = 1
  for (let i = 1; i < pos.length - 1; i++) {
    if (Number.isFinite(pos[i]!)) continue
    let j = i
    while (j < pos.length && !Number.isFinite(pos[j]!)) j++ // j = 다음으로 아는 위치 (마지막은 항상 안다)
    const from = pos[i - 1]!
    const to = pos[j]!
    const n = j - (i - 1)
    for (let k = i; k < j; k++) pos[k] = from + ((to - from) * (k - (i - 1))) / n
    i = j - 1
  }

  const t = gradientT(direction, px, py, w, h)
  if (t <= pos[0]!) return alphas[0]!
  for (let i = 1; i < pos.length; i++) {
    const a = pos[i - 1]!
    const b = pos[i]!
    if (t <= b) {
      const f = b > a ? (t - a) / (b - a) : 1
      return alphas[i - 1]! + (alphas[i]! - alphas[i - 1]!) * f
    }
  }
  return alphas[alphas.length - 1]!
}

// ---------------------------------------------------------------------------
// 이미지

/** `'center 20%'` -> [0.5, 0.2]. background-position 과 같은 뜻. */
function posFractions(position?: string): [number, number] {
  const words: Record<string, number> = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 }
  const toks = (position ?? 'center').trim().toLowerCase().split(/\s+/).filter(Boolean)
  const val = (t: string | undefined, d: number): number => {
    if (t === undefined) return d
    if (t in words) return words[t]!
    if (t.endsWith('%')) {
      const v = parseFloat(t) / 100
      return Number.isFinite(v) ? v : d
    }
    return d
  }
  // 세로 키워드가 먼저 오는 표기(`top center`)도 허용한다
  if (toks.length === 2 && (toks[0] === 'top' || toks[0] === 'bottom')) {
    return [val(toks[1], 0.5), val(toks[0], 0.5)]
  }
  return [val(toks[0], 0.5), val(toks[1], 0.5)]
}

/**
 * 이미지 레이어의 그 지점 알파.
 *
 * `contain` 으로 넣으면 상자 안에 **그림이 안 닿는 여백**이 생기는데,
 * 거기는 눌러도 이 레이어가 아니라 뒤가 잡혀야 한다.
 */
function imageAlpha(l: ImageLayer, px: number, py: number, map: AlphaMap): number {
  if (map.w <= 0 || map.h <= 0) return 1
  let dw: number
  let dh: number
  if ((l.fit ?? 'cover') === 'fill') {
    dw = l.w
    dh = l.h
  } else {
    const sx = l.w / map.w
    const sy = l.h / map.h
    const s = l.fit === 'contain' ? Math.min(sx, sy) : Math.max(sx, sy)
    dw = map.w * s
    dh = map.h * s
  }
  const [fx, fy] = posFractions(l.position)
  const u = (px - (l.w - dw) * fx) / dw
  const v = (py - (l.h - dh) * fy) / dh
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0
  const ix = Math.min(map.w - 1, Math.floor(u * map.w))
  const iy = Math.min(map.h - 1, Math.floor(v * map.h))
  return (map.a[iy * map.w + ix] ?? 255) / 255
}

// ---------------------------------------------------------------------------

/** 조작 상자(직사각형) 안인지. 이미 고른 레이어를 계속 끌 때 쓴다. */
export function inBox(l: Layer, p: Point): boolean {
  return p.x >= l.x && p.x <= l.x + l.w && p.y >= l.y && p.y <= l.y + l.h
}

/** 이 지점이 이 레이어의 «칠해진 곳» 인가. */
export function hitLayer(l: Layer, p: Point, inst: Instance | undefined, probe: Probe = {}): boolean {
  if (l.hidden) return false
  if ((l.opacity ?? 1) < 0.02) return false // 안 보이는 건 못 집는다
  const px = p.x - l.x
  const py = p.y - l.y
  if (px < 0 || py < 0 || px > l.w || py > l.h) return false

  switch (l.kind) {
    case 'rect': {
      if (!inRoundedRect(px, py, l.w, l.h, l.radius)) return false
      if (colorAlpha(l.fill) > MIN_ALPHA) return true
      const sw = l.strokeWidth ?? 0.3
      if (sw > 0 && colorAlpha(l.stroke) > MIN_ALPHA) {
        // 속이 빈 테두리 도형 — 선 위만 집힌다. 가운데는 뒤가 잡혀야 맞다.
        const band = Math.max(sw, MIN_GRAB)
        return px <= band || py <= band || px >= l.w - band || py >= l.h - band
      }
      return false
    }

    case 'gradient': {
      if (!inRoundedRect(px, py, l.w, l.h, l.radius)) return false
      return gradientAlpha(l.stops, l.direction, px, py, l.w, l.h) > MIN_ALPHA
    }

    case 'image': {
      if (!inRoundedRect(px, py, l.w, l.h, l.radius)) return false
      const id = resolveAsset(l, inst)
      if (!id) return true // 아직 그림이 없는 «자리» — 집을 수 있어야 넣는다
      const map = probe.alpha?.(id)
      if (!map) return true // 아직 못 읽음 — 예전처럼 상자 전체
      return imageAlpha(l, px, py, map) > MIN_ALPHA
    }

    case 'text': {
      if (!resolveText(l, inst).trim()) return true // 빈 글자 자리도 집을 수 있어야 한다
      const boxes = probe.textBoxes?.(l.id)
      if (!boxes || boxes.length === 0) return true
      // 글자 획 하나하나가 아니라 **줄 상자** 기준. 획 사이를 눌렀다고
      // 뒤가 잡히면 글자를 집는 게 너무 어려워진다.
      return boxes.some(
        (b) =>
          px >= b.x - MIN_GRAB &&
          px <= b.x + b.w + MIN_GRAB &&
          py >= b.y - MIN_GRAB &&
          py <= b.y + b.h + MIN_GRAB
      )
    }
  }
}

/**
 * 앞에서 뒤로 훑어 처음 만나는 «칠해진» 레이어의 자리(index).
 * 없으면 -1. 배열은 뒤에서 앞 순서(`Component.layers`)다.
 */
export function pickIndex(layers: Layer[], p: Point, inst: Instance | undefined, probe: Probe = {}): number {
  for (let i = layers.length - 1; i >= 0; i--) {
    if (hitLayer(layers[i]!, p, inst, probe)) return i
  }
  return -1
}

/**
 * 실제로 고를 레이어.
 *
 * 규칙은 두 줄이다:
 *  1. 칠해진 것 중 **가장 앞** 을 고른다
 *  2. 이미 고른 레이어가 그보다 **앞에 있고** 상자 안이면 그걸 유지한다
 *     — 투명한 부분을 잡아도 계속 끌 수 있어야 하니까.
 *     단 «앞에 있을 때만» 이다. 위에 덮인 걸 눌렀는데 아래 것이 계속
 *     잡히면 그게 더 답답하다.
 */
export function pickLayer(
  layers: Layer[],
  p: Point,
  inst: Instance | undefined,
  selectedId: string | null,
  probe: Probe = {},
  /** 투명한 곳도 그냥 잡는다 (Ctrl 누르고 클릭). 옅은 그늘처럼 집기 어려운 것 때문에 둔다. */
  ignoreAlpha = false
): Layer | null {
  if (ignoreAlpha) {
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i]!
      if (!l.hidden && inBox(l, p)) return l
    }
    return null
  }
  const hit = pickIndex(layers, p, inst, probe)
  const si = selectedId ? layers.findIndex((l) => l.id === selectedId) : -1
  if (si > hit) {
    const sel = layers[si]!
    if (!sel.hidden && inBox(sel, p)) return sel
  }
  return hit >= 0 ? layers[hit]! : null
}
