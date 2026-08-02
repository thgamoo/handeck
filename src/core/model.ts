/**
 * 프로젝트 모델 — 저장 형식이자 앱의 공개 인터페이스.
 *
 * 핵심은 **컴포넌트와 인스턴스**다.
 * 컴포넌트는 카드 한 종류의 «틀» 이고, 인스턴스는 실제 카드 한 장이다.
 * 레이어는 기본적으로 공통이고, `override` 가 붙은 것만 인스턴스마다 값을 갖는다.
 *
 * 이 구조 덕분에 사용자가 배울 문법이 없다 — `{{ }}` 같은 걸 타이핑하지 않는다.
 * 그리고 틀을 나중에 고쳐도 카드 100장에 한 번에 반영된다.
 *
 * 좌표·크기는 전부 mm. 화면 배율과 무관하다.
 */

export type Shape = 'rect' | 'circle'
export type Fit = 'cover' | 'contain' | 'fill'
export type Align = 'left' | 'center' | 'right'
export type VAlign = 'top' | 'middle' | 'bottom'

/** 인스턴스가 덮어쓸 수 있는 자리의 종류 */
export type Override = 'text' | 'image'

interface LayerBase {
  id: string
  name: string
  /** mm, **재단 크기의 좌상단** 기준. 도련은 좌표에 들어가지 않는다. */
  x: number
  y: number
  w: number
  h: number
  hidden?: boolean
  locked?: boolean
  opacity?: number
  /** 있으면 인스턴스마다 다른 값을 갖는다. 없으면 모든 카드가 공유. */
  override?: Override
}

export interface ImageLayer extends LayerBase {
  kind: 'image'
  /** 공통 이미지의 에셋 id. override 가 있으면 인스턴스 값이 우선. */
  asset?: string
  fit?: Fit
  /** background-position. 예: 'center 20%' */
  position?: string
  /** mm. 모서리 둥글기 */
  radius?: number
}

export interface TextLayer extends LayerBase {
  kind: 'text'
  /** 공통 문구. override 가 있으면 인스턴스 값이 우선. */
  text?: string
  font?: string
  /** pt */
  size?: number
  weight?: number
  color?: string
  align?: Align
  valign?: VAlign
  lineHeight?: number
  italic?: boolean
  /** mm */
  letterSpacing?: number
  shadow?: string
  /** 넘치면 글자를 줄여 맞춘다 */
  shrink?: boolean
}

export interface RectLayer extends LayerBase {
  kind: 'rect'
  fill?: string
  stroke?: string
  /** mm */
  strokeWidth?: number
  /** mm. 폭의 절반이면 원. */
  radius?: number
}

export interface GradientLayer extends LayerBase {
  kind: 'gradient'
  /** CSS linear-gradient 방향. 예: 'to bottom' */
  direction?: string
  stops: string[]
  /**
   * mm. 모서리 둥글기.
   * 둥근 이미지 위에 그늘을 얹을 때 그늘 모서리가 튀어나오는 걸 막는다.
   * 폭의 절반으로 두면 원이 된다.
   */
  radius?: number
}

export type Layer = ImageLayer | TextLayer | RectLayer | GradientLayer

export interface PieceSize {
  /** 재단 크기 (mm). **카드는 이게 전부다 — 도련은 여기 없다.** */
  w: number
  h: number
  shape: Shape
}

export interface Component {
  id: string
  name: string
  size: PieceSize
  background: string
  /** 뒤에서 앞 순서 */
  layers: Layer[]
}

export interface Instance {
  id: string
  /** 몇 장 찍을지 */
  qty: number
  /** 레이어 id -> 값. text 면 문자열, image 면 에셋 id. */
  values: Record<string, string>
}

export interface SheetSpec {
  /** mm */
  w: number
  h: number
  margin: number
  gap: number
  marks: 'crop' | 'none'
  /**
   * 도련 (mm).
   *
   * **조각의 속성이 아니라 인쇄물의 속성이다.** 카드는 63×88 그 자체이고,
   * 도련은 «자를 때 밀리는 것» 에 대한 대비라서 **종이에 깔 때** 생긴다.
   * 그래서 편집 캔버스에는 도련이 없고, 최종 인쇄에서만 붙는다.
   *
   * 없으면 3mm 로 본다 (`bleedMode` 가 `none` 이면 쓰이지 않는다).
   */
  bleed?: number
  /**
   * 종이에 깔 때 도련을 어떻게 붙일지. **인쇄할 때 바꾸는 스위치다.**
   *
   *  `none`  — 안 붙인다. 조각끼리 맞붙어 칼질 한 번에 두 장이 잘린다.
   *  `outer` — 맞붙이되 **깔린 덩어리의 바깥 네 변에만** 붙인다.
   *            안쪽 이음매는 이웃 조각이 서로의 도련 노릇을 하므로 필요 없고,
   *            바깥으로 밀려 잘릴 때만 흰 테두리가 생기니 거기만 막는다.
   *  `each`  — 조각마다 사방에 붙이고 그만큼 띄운다. 인쇄소에 낱장으로 맡길 때.
   *
   * 없으면 `none`.
   */
  bleedMode?: 'none' | 'outer' | 'each'
}

export interface Deck {
  id: string
  name: string
  component: string
  /** 뒷면으로 쓸 컴포넌트 id */
  back?: string
  sheet: SheetSpec
  duplex: false | 'long' | 'short'
  /** 기대 장수. 어긋나면 경고. */
  expect?: number
  instances: Instance[]
}

/**
 * 이 프로젝트가 쓰는 글꼴.
 *
 * **파일은 여기 안 들어간다** (IndexedDB 에 있다). 그림과 같은 규칙이다 —
 * 프로젝트 파일은 가볍게 두고, 무거운 건 브라우저 저장소에 둔다.
 * 대신 여기 적힌 게 있어야 다른 브라우저에서 열었을 때
 * «이 프로젝트는 글꼴 두 개가 더 필요하다» 를 말해줄 수 있다.
 */
export interface FontRef {
  /** 글꼴 파일의 내용 해시 */
  id: string
  /** 글자 레이어의 `font` 가 가리키는 이름 */
  family: string
  /** 원래 파일 이름 — 없을 때 무엇을 찾아야 하는지 알려주려고 */
  name: string
}

/**
 * 키워드 — 카드 글에 나오면 자동으로 다르게 그려지는 낱말.
 *
 * 보드게임 카드에서 «돌진», «선제» 같은 말은 **규칙 용어**라 본문과 구분돼야 한다.
 * 카드마다 손으로 굵게 만들면 100장을 고쳐야 하고 빠뜨리기도 한다.
 * 여기 한 번 적어두면 모든 카드에서 같은 모양으로 나온다.
 *
 * **프로젝트 전체가 공유한다.** 규칙 용어는 덱 하나의 것이 아니다 —
 * «돌진» 은 능력 카드에도 재앙 카드에도 나온다. 한 덱에서만 쓰고 싶으면
 * 그 덱에서만 그 낱말을 안 쓰면 된다.
 */
export interface Keyword {
  id: string
  /** 카드 글에서 찾을 말 */
  word: string
  style: 'bold' | 'chip' | 'color'
  /** 글자색 (칩이면 칩 안 글자색) */
  color?: string
  /** 칩 배경색 */
  bg?: string
}

export interface Project {
  handeck: 1
  name: string
  components: Record<string, Component>
  decks: Deck[]
  fonts?: FontRef[]
  keywords?: Keyword[]
}

// ---------------------------------------------------------------------------

export const A4: SheetSpec = { w: 210, h: 297, margin: 10, gap: 0, marks: 'crop', bleed: 3, bleedMode: 'none' }
// Letter 규격은 속성 패널의 «종이» 목록에서 직접 고른다 (215.9 × 279.4).
// 상수를 따로 두면 두 곳이 갈릴 수 있어 A4 하나만 남긴다.

/** 자주 쓰는 조각 규격. 없는 건 직접 입력하면 된다. */
export const PIECE_PRESETS: { name: string; size: PieceSize }[] = [
  { name: '카드 · 포커 63×88', size: { w: 63, h: 88, shape: 'rect' } },
  { name: '카드 · 브리지 56×87', size: { w: 56, h: 87, shape: 'rect' } },
  { name: '카드 · 미니 44×68', size: { w: 44, h: 68, shape: 'rect' } },
  { name: '카드 · 타로 70×120', size: { w: 70, h: 120, shape: 'rect' } },
  { name: '타일 · 정사각 50×50', size: { w: 50, h: 50, shape: 'rect' } },
  { name: '토큰 · 원형 25', size: { w: 25, h: 25, shape: 'circle' } },
  { name: '토큰 · 원형 35', size: { w: 35, h: 35, shape: 'circle' } },
  { name: '토큰 · 원형 45', size: { w: 45, h: 45, shape: 'circle' } },
]

/**
 * 도련을 쓸 수 있는가. **지금은 꺼둔다 (2026-08-02).**
 *
 * `outer` 로 뽑아보니 도련이 붙는 게 아니라 **카드가 통째로 커져 보인다.**
 * 짐작되는 곳: 조각을 늘리면(`expandForBleed`) 판 자체가 커지는데, 가장자리에
 * 닿지 않은 레이어는 자리만 밀리므로 그 3mm 가 배경색 테두리로 남는다.
 * 게다가 재단 표시는 종이 가장자리에만 짧게 그어져서 **가운데 칸은 어디가
 * 잘릴 자리인지 화면에서 보이지 않는다.** 그래서 «커진 카드» 로 읽힌다.
 * 다음 마일스톤에서 이 두 가지(늘리는 방식 · 재단선 보이기)를 같이 손본다.
 *
 * 끄면 «맞붙이기» 하나만 남는다 — 집에서 잘라 쓰는 데는 그게 맞고,
 * 도련이 필요한 인쇄소 입고는 아직 이 도구의 목표가 아니다.
 *
 * 되살릴 때는 이 값을 `true` 로 바꾸면 된다. 계산·UI 는 그대로 두었다.
 */
export const BLEED_ENABLED = false

/** 종이에 붙일 도련 (mm). `none` 이거나 기능이 꺼져 있으면 0. */
export function sheetBleed(sheet: SheetSpec): number {
  if (!BLEED_ENABLED) return 0
  const mode = sheet.bleedMode ?? 'none'
  return mode === 'none' ? 0 : Math.max(0, sheet.bleed ?? 3)
}

/** 인스턴스가 실제로 쓸 값 — 오버라이드가 있으면 인스턴스 값, 없으면 컴포넌트 값. */
export function resolveText(layer: TextLayer, inst?: Instance): string {
  if (layer.override === 'text' && inst) return inst.values[layer.id] ?? layer.text ?? ''
  return layer.text ?? ''
}

export function resolveAsset(layer: ImageLayer, inst?: Instance): string | undefined {
  if (layer.override === 'image' && inst) return inst.values[layer.id] || layer.asset
  return layer.asset
}

/** 수량까지 펼친 총 장수 */
export function totalPieces(deck: Deck): number {
  return deck.instances.reduce((s, i) => s + Math.max(0, i.qty | 0), 0)
}

export const uid = (prefix: string): string =>
  `${prefix}-${Math.random().toString(36).slice(2, 8)}`

/**
 * 이 프로젝트에서 실제로 쓰이고 있는 색을 모은다 — 색 고르개의 «이 작업에 쓴 색».
 *
 * 팔레트를 따로 관리하게 하지 않는 게 요점이다. 한 번 쓴 색은 그냥 다시 나온다.
 * 등장 순서를 유지하고 중복만 없앤다.
 */
export function usedColors(p: Project): string[] {
  const out: string[] = []
  const add = (c?: string) => {
    if (!c) return
    const v = c.trim()
    if (v && v !== 'transparent' && !out.includes(v)) out.push(v)
  }
  for (const c of Object.values(p.components)) {
    add(c.background)
    for (const l of c.layers) {
      if (l.kind === 'text') add(l.color)
      else if (l.kind === 'rect') {
        add(l.fill)
        add(l.stroke)
      } else if (l.kind === 'gradient') l.stops.forEach((s) => add(stopColor(s)))
    }
  }
  return out
}

/** 'rgba(0,0,0,.6) 40%' 처럼 위치가 붙은 색 단계에서 색 부분만 뽑는다. */
function stopColor(stop: string): string {
  const s = stop.trim()
  // 괄호 안의 쉼표를 건드리지 않으려면 괄호 밖에서만 잘라야 한다
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')') depth--
    else if (s[i] === ' ' && depth === 0) return s.slice(0, i)
  }
  return s
}
