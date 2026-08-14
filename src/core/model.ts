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

/**
 * 글 덩어리 — **룰북 본문.**
 *
 * 글자 레이어(`text`)와 무엇이 다른가. 저쪽은 «한 줄짜리 제목·문장» 이라
 * 상자 하나에 한 가지 모양만 들어간다. 룰북 본문은 소제목·목록·표가 섞인
 * **문서 한 덩어리**라, 그걸 레이어로 쪼개면 문장 하나 고칠 때마다
 * 아래 상자를 전부 다시 잡아야 한다.
 *
 * 그래서 내용은 **마크다운 원문 그대로** 두고 (`text`, 인스턴스마다 다름),
 * 소제목·목록·표는 그릴 때 해석한다 (`core/markdown.ts`).
 */
export interface MarkdownLayer extends LayerBase {
  kind: 'md'
  /** 마크다운 원문. override 가 있으면 쪽(인스턴스) 값이 우선 */
  text?: string
  font?: string
  /** pt — 본문 기준 크기. 소제목은 여기에 배수로 붙는다 */
  size?: number
  color?: string
  lineHeight?: number
  align?: Align
  /** 단 수. 2 면 두 단으로 흐른다 (룰북에서 흔하다) */
  columns?: number
  /** mm. 단 사이 간격 */
  gap?: number
}

export type Layer = ImageLayer | TextLayer | RectLayer | GradientLayer | MarkdownLayer

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
  /**
   * 뒷면 격자를 **좌우로 뒤집을지.** 없으면 뒤집는다(`true`).
   *
   * 뒤집는 것이 맞다 — 세로 종이를 긴 쪽(책장 넘기듯)으로 넘기면 앞면 왼쪽 칸이
   * 뒷면에서는 오른쪽에 오기 때문이다. 그래서 기본값이 «뒤집기» 다.
   *
   * **그런데 이걸 끌 수 있어야 한다.** 드라이버·기종마다 뒤집는 축이 다르고
   * (특히 수동 양면에서 종이를 손으로 다시 넣을 때는 넣는 방향이 곧 축이다),
   * 어긋났을 때 원인을 알아내는 것보다 **반대 버전을 한 장 뽑아 대보는 편이 빠르다.**
   * 자로 재는 것보다 실물 두 장이 확실하다.
   */
  mirrorBack?: boolean
  /** 기대 장수. 어긋나면 경고. */
  expect?: number
  /**
   * 이 덱에 대한 메모.
   *
   * «뒷면이 운명 카드와 같아야 한다», «원래 동그란 토큰인데 재료가 없어 카드로 뽑는다»
   * 같은 것. 규칙 문서에는 있지만 카드에는 안 적히는, 그런데 나중에 반드시 잊어버리는
   * 이유들을 붙여둔다.
   */
  note?: string
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
  style: 'bold' | 'chip' | 'outline' | 'color'
  /** 글자색 (칩이면 칩 안 글자색) */
  color?: string
  /** 칩 배경색 — 테두리 칩이면 테두리 색 */
  bg?: string
}

/**
 * 보드 — **한 장짜리 큰 인쇄물.** 판, 참조표, 점수판 같은 것.
 *
 * 덱과 무엇이 다른가:
 *   덱은 «작은 조각 여러 장» 이라 한 종이에 격자로 깔고 잘라낸다.
 *   보드는 «한 장이 종이만큼, 또는 종이보다 크다» — 격자가 없고 자르는 대신
 *   **모자라면 여러 장에 나눠 깔아 이어 붙인다.**
 *
 * 그래서 인스턴스가 없다. 보드는 틀이 곧 결과물이다 —
 * «같은 틀로 100장» 이 필요한 물건이 아니다.
 */
export interface Board {
  id: string
  name: string
  /** 이 보드의 틀. 틀의 `size` 가 곧 보드의 실물 크기다 */
  component: string
  /** 어떤 종이에 뽑을지 */
  sheet: SheetSpec
  /**
   * 종이에 어떻게 앉힐지.
   *
   *  `single` — **한 장에 그대로.** A3 보드를 A3 종이에 뽑는 길이다.
   *             종이보다 크면 삐져나가므로 미리보기가 경고한다.
   *  `tile`   — **여러 장에 나눠 깔고 이어 붙인다.** 집 프린터가 A4 뿐일 때.
   *
   * 없으면 `single`.
   */
  tiling?: 'single' | 'tile'
  /**
   * 타일링할 때 이웃 장과 **겹치는 폭** (mm). 풀칠 여유다.
   *
   * 딱 맞게 자르면 종이 두께만큼 틈이 벌어지고 밀리면 흰 줄이 생긴다.
   * 겹쳐 두면 위에 얹어 붙일 자리가 생기고, 조금 밀려도 티가 안 난다.
   * 없으면 10mm.
   */
  overlap?: number
  /** 이 보드에 대한 메모 (덱의 `note` 와 같은 자리) */
  note?: string
}

/**
 * 룰북 — **여러 쪽짜리 인쇄물.**
 *
 * 덱·보드와 무엇이 다른가:
 *   덱은 «작은 조각 여러 장» 이라 한 종이에 격자로 깔고 **잘라낸다**.
 *   보드는 «한 장이 종이만큼 크다» 라 나눠 뽑아 **이어 붙인다**.
 *   룰북은 «작은 쪽이 순서대로 여러 장» 이라 **접거나 스테이플러로 묶는다** —
 *   그래서 쪽 **순서**와 **앞뒤 짝**이 전부다. 자를 것도 이어 붙일 것도 없다.
 *
 * 구조는 덱과 같다. 쪽 하나가 인스턴스 하나이고, 틀(`component`)은 모든 쪽이 공유한다 —
 * 머리말·쪽번호·여백을 한 번만 잡으면 20쪽이 같이 따라온다는 뜻이다.
 * 다른 점은 **수량(`qty`)이 늘 1** 이라는 것뿐이다. 룰북 3쪽을 «2장» 찍을 일은 없다.
 */
export interface Rulebook {
  id: string
  name: string
  /** 쪽 틀. 이 틀의 `size` 가 곧 **한 쪽의 크기**다 (종이 크기가 아니다) */
  component: string
  /** 어느 종이에 뽑을지 */
  sheet: SheetSpec
  /**
   * 어떻게 묶을지. **이게 종이에 쪽을 앉히는 방식을 정한다.**
   *
   *  `saddle` — **접어서 중철.** 종이 한 면에 두 쪽이 나란히 눕고, 반으로 접어
   *             겹친 뒤 접힌 등에 스테이플러를 박는다. 쪽 순서가 뒤집혀 깔리므로
   *             (마지막 쪽이 첫 쪽 왼쪽에 온다) **총 쪽수가 4의 배수**여야 한다.
   *  `staple` — **모서리 스테이플.** 한 면에 한 쪽씩, 차례대로. 쪽 크기와 종이가
   *             같을 때 쓴다. 왼쪽 위를 한 번 박으면 끝이라 시제품에 가장 편하다.
   *
   * 없으면 `saddle`. A5 룰북을 A4 에 접어 뽑는 것이 집에서 가장 흔한 길이다.
   */
  binding?: 'saddle' | 'staple'
  /**
   * 양면으로 뽑을지. `false` 면 **한 면만** 쓴다 (뒷장이 빈 채로 나온다).
   *
   * 중철은 사실상 양면이 전제다 — 단면으로 접으면 속이 백지가 된다.
   * 그래도 «일단 앞면만 뽑아 확인» 하는 경우가 있어 끌 수 있게 둔다.
   */
  duplex?: false | 'long' | 'short'
  note?: string
  /** 쪽. 순서가 곧 읽는 순서다 */
  pages: Instance[]
}

export interface Project {
  handeck: 1
  name: string
  components: Record<string, Component>
  decks: Deck[]
  /** 한 장짜리 큰 인쇄물. 없으면 빈 목록으로 본다 */
  boards?: Board[]
  /** 여러 쪽짜리 인쇄물 (룰북·설명서). 없으면 빈 목록으로 본다 */
  rulebooks?: Rulebook[]
  fonts?: FontRef[]
  keywords?: Keyword[]
  printGroups?: PrintGroup[]
}

/**
 * 덱 하나를 통째로 주고받는 꾸러미 — JSON 편집기가 쓴다.
 *
 * **다른 프로젝트의 레이어 구조를 그대로 가져오려고** 있다. 카드 한 종류를
 * 잘 짜두면 그 틀은 다음 게임에서도 쓸 만한데, 지금까지는 손으로 다시 그려야 했다.
 *
 * 프로젝트 파일과 달리 **id 를 신경 쓰지 않아도 된다** — 붙여넣을 때
 * 지금 덱의 id 를 유지하고 내용만 갈아끼우기 때문이다.
 */
export interface DeckJson {
  handeck: 1
  kind: 'deck'
  /** 덱 자체의 설정 (이름·종이·양면·메모) */
  deck: Pick<Deck, 'name' | 'sheet' | 'duplex'> & Partial<Pick<Deck, 'expect' | 'note'>>
  front: Component
  back?: Component
  /** 카드 내용. 가져올지는 고를 수 있다 */
  instances?: Instance[]
}

/** 이 덱을 JSON 꾸러미로 */
export function deckToJson(p: Project, deck: Deck): DeckJson {
  const front = p.components[deck.component]!
  const back = deck.back ? p.components[deck.back] : undefined
  return {
    handeck: 1,
    kind: 'deck',
    deck: {
      name: deck.name,
      sheet: deck.sheet,
      duplex: deck.duplex,
      ...(deck.expect !== undefined ? { expect: deck.expect } : {}),
      ...(deck.note ? { note: deck.note } : {}),
    },
    front,
    ...(back ? { back } : {}),
    instances: deck.instances,
  }
}

/** 붙여넣은 것이 덱 꾸러미인지. 아니면 왜 아닌지 알려준다. */
export function checkDeckJson(v: unknown): { ok: true; value: DeckJson } | { ok: false; why: string } {
  const d = v as Partial<DeckJson>
  if (!d || typeof d !== 'object') return { ok: false, why: 'JSON 객체가 아닙니다' }
  if (d.handeck !== 1) return { ok: false, why: 'handeck 자료가 아닙니다 (handeck: 1 이 없습니다)' }
  if (d.kind !== 'deck') return { ok: false, why: `덱 꾸러미가 아닙니다 (kind: ${String(d.kind)})` }
  if (!d.front?.layers || !Array.isArray(d.front.layers)) return { ok: false, why: '앞면 틀(front.layers)이 없습니다' }
  if (!d.front.size?.w || !d.front.size?.h) return { ok: false, why: '앞면 규격(front.size)이 없습니다' }
  return { ok: true, value: d as DeckJson }
}

/** 이 덱이 속한 인쇄 묶음 */
export function groupOf(p: Project, deckId: string): PrintGroup | undefined {
  return (p.printGroups ?? []).find((g) => g.decks.includes(deckId))
}

/** 인쇄할 때 실제로 함께 깔릴 덱들 (묶음이 없으면 자기 혼자) */
export function printSet(p: Project, deckId: string): Deck[] {
  const g = groupOf(p, deckId)
  const ids = g ? g.decks : [deckId]
  return ids.map((id) => p.decks.find((d) => d.id === id)).filter((d): d is Deck => !!d)
}

// ---------------------------------------------------------------------------

export const A4: SheetSpec = { w: 210, h: 297, margin: 10, gap: 0, marks: 'crop', bleed: 3, bleedMode: 'none' }
/** 보드의 기본 종이. 판은 A4 한 장으로는 대개 모자라다 */
export const A3: SheetSpec = { ...A4, w: 297, h: 420 }

/**
 * 고를 수 있는 종이.
 *
 * **한 곳에만 적는다.** 전에는 속성 패널의 `<option>` 에 직접 박아둬서
 * 보드 쪽에 A3 를 넣으려면 같은 목록을 또 적어야 했다.
 *
 * A 계열은 반씩 접힌다 — A3 를 반 접으면 A4 다. 그래서 A3 판을
 * A4 두 장에 나눠 뽑는 것이 (`tiling: 'tile'`) 딱 맞아떨어진다.
 */
export const SHEET_PRESETS: { name: string; w: number; h: number }[] = [
  { name: 'A4 세로 (210×297)', w: 210, h: 297 },
  { name: 'A4 가로 (297×210)', w: 297, h: 210 },
  { name: 'A3 세로 (297×420)', w: 297, h: 420 },
  { name: 'A3 가로 (420×297)', w: 420, h: 297 },
  { name: 'Letter 세로 (215.9×279.4)', w: 215.9, h: 279.4 },
  { name: 'Letter 가로 (279.4×215.9)', w: 279.4, h: 215.9 },
]

/**
 * 보드 **판 자체**의 크기 프리셋. 종이 목록과 다른 자리다 —
 * 「A3 판을 A4 두 장에 뽑기」 처럼 판과 종이가 갈릴 수 있기 때문이다.
 */
export const BOARD_PRESETS: { name: string; size: PieceSize }[] = [
  { name: '판 · A4 세로 210×297', size: { w: 210, h: 297, shape: 'rect' } },
  { name: '판 · A4 가로 297×210', size: { w: 297, h: 210, shape: 'rect' } },
  { name: '판 · A3 세로 297×420', size: { w: 297, h: 420, shape: 'rect' } },
  { name: '판 · A3 가로 420×297', size: { w: 420, h: 297, shape: 'rect' } },
  { name: '판 · A2 가로 594×420', size: { w: 594, h: 420, shape: 'rect' } },
  { name: '판 · 정사각 300×300', size: { w: 300, h: 300, shape: 'rect' } },
]

/**
 * 룰북 **한 쪽**의 크기 프리셋.
 *
 * A 계열이 반씩 접히는 것이 여기서 그대로 쓸모가 된다 —
 * A5 쪽 두 개가 A4 한 장이고, A6 두 개가 A5 한 장이다. 중철이 딱 맞아떨어진다.
 * 목록의 «(A4 에 접어서)» 는 그 쪽 크기의 **중철 짝**을 알려주는 말이다.
 */
export const PAGE_PRESETS: { name: string; size: PieceSize; sheet: { w: number; h: number } }[] = [
  { name: 'A5 세로 148×210 (A4 가로에 접어서)', size: { w: 148, h: 210, shape: 'rect' }, sheet: { w: 297, h: 210 } },
  { name: 'A6 세로 105×148 (A5 가로에 접어서)', size: { w: 105, h: 148, shape: 'rect' }, sheet: { w: 210, h: 148 } },
  { name: 'A4 세로 210×297 (한 면에 한 쪽)', size: { w: 210, h: 297, shape: 'rect' }, sheet: { w: 210, h: 297 } },
  { name: '정사각 140×140 (280×140 에 접어서)', size: { w: 140, h: 140, shape: 'rect' }, sheet: { w: 280, h: 140 } },
]

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
  // 원형 토큰과 **같은 크기의 네모**. 둥글게 자르는 게 번거로울 때, 또는 아직
  // 펀치가 없어 가위로 잘라야 할 때 이걸 쓴다 (지름이 곧 한 변이 된다).
  { name: '토큰 · 네모 25×25', size: { w: 25, h: 25, shape: 'rect' } },
  { name: '토큰 · 네모 35×35', size: { w: 35, h: 35, shape: 'rect' } },
  { name: '토큰 · 네모 45×45', size: { w: 45, h: 45, shape: 'rect' } },
]

/**
 * 인쇄 묶음 — **여러 덱을 한 종이에 이어 깐다.**
 *
 * 덱마다 따로 인쇄하면 마지막 장은 늘 반쯤 빈다. 10장짜리 덱 다섯 개를 각각 뽑으면
 * A4 다섯 장인데(9칸 중 1칸씩 버림), 묶으면 50장 = **여섯 장**이면 된다.
 * 시제품을 여러 번 뽑는 초기 단계에서는 이 차이가 크다.
 *
 * **규격이 같은 덱만 묶을 수 있다.** 칸 크기가 다르면 한 격자에 못 깐다.
 */
export interface PrintGroup {
  id: string
  name: string
  /** 묶을 덱 id. 순서대로 이어 깔린다 */
  decks: string[]
  /**
   * 목록에 붙는 쇠사슬 표시의 색.
   *
   * 묶음이 둘 이상이면 «이 덱이 어느 묶음인지» 를 색으로 구분한다.
   * 없으면 만든 순서대로 아래 팔레트에서 준다.
   */
  color?: string
}

/** 묶음 색 팔레트 — 서로 잘 구분되는 것들로 */
export const GROUP_COLORS = ['#7D1F38', '#1F4E79', '#6D8F7A', '#C8A32E', '#6B4E9E', '#C9738C']

export const groupColor = (g: PrintGroup, i: number): string =>
  g.color ?? GROUP_COLORS[i % GROUP_COLORS.length]!

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
export function resolveText(layer: TextLayer | MarkdownLayer, inst?: Instance): string {
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
      if (l.kind === 'text' || l.kind === 'md') add(l.color)
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
