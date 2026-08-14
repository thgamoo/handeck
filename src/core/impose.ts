/**
 * 조판 — 조각들을 종이에 어떻게 깔지 계산한다.
 *
 * 순수 함수다. DOM 도 브라우저도 모른다. 그래서 그냥 테스트할 수 있다.
 * 실제로 그리는 건 `ui/Print.tsx`, 여기서는 좌표만 낸다.
 *
 * **도련이 생기는 곳이 여기다.** 카드에는 도련이 없다 — 63×88 이 전부다.
 * 도련은 «자르다 밀리는 것» 에 대한 대비라서 종이에 깔 때, 그것도
 * 밀릴 수 있는 변에만 붙는다. 어느 변인지는 이 파일이 정한다.
 *
 * 단위는 전부 mm.
 */

import {
  BLEED_ENABLED,
  sheetBleed,
  type Component,
  type Deck,
  type Instance,
  type PieceSize,
  type Project,
  type SheetSpec,
} from './model.ts'
import { NO_EDGES, type Edges } from './render.tsx'

export interface Cell {
  /** 종이 좌상단 기준, **재단 크기 조각**의 좌상단 (도련은 이 밖으로 나간다) */
  x: number
  y: number
  instance: Instance
  /**
   * 이 칸이 쓸 앞면 틀.
   *
   * **칸마다 다를 수 있다.** 여러 덱을 묶어 한 종이에 깔면 한 장 안에
   * «능력 카드» 와 «재앙 카드» 가 섞인다. 그래서 «이 페이지의 틀» 이 아니라
   * «이 칸의 틀» 로 들고 있어야 한다.
   */
  front: Component
  /** 이 칸의 뒷면 틀. 없으면 뒷면을 안 찍는다 */
  back?: Component
  /** 격자에서의 자리. 뒷면을 좌우로 뒤집을 때 쓴다. */
  col: number
  row: number
  /** 이 조각에서 도련을 붙일 변 */
  edges: Edges
}

export interface Page {
  /** 1 부터 */
  no: number
  /** 앞면인지 뒷면인지. 뒷면 컴포넌트가 없으면 전부 앞면. */
  side: 'front' | 'back'
  cells: Cell[]
}

export interface Plan {
  pages: Page[]
  /** 재단 크기 조각 하나의 크기 */
  piece: { w: number; h: number }
  /** 이 인쇄에 붙는 도련 (mm). `bleedMode: none` 이면 0 */
  bleed: number
  bleedMode: 'none' | 'outer' | 'each'
  cols: number
  rows: number
  sheet: SheetSpec
  /** 자를 위치 — 종이 좌상단 기준. 재단선을 그리는 데 쓴다. */
  cutsX: number[]
  cutsY: number[]
}

/**
 * 격자 계산.
 *
 * `each` 는 조각마다 사방에 도련을 붙이므로 **칸 자체가 커진다.**
 * `outer` 는 조각끼리 맞붙고 덩어리의 바깥으로만 도련이 삐져나가므로
 * **칸 크기는 그대로고 덩어리만 사방 b 만큼 커진다.**
 */
export function layout(size: PieceSize, sheet: SheetSpec): {
  cols: number
  rows: number
  /** 칸 간격 (재단 크기 + each 도련 + 사이 띄우기) */
  stepX: number
  stepY: number
  bleed: number
  mode: 'none' | 'outer' | 'each'
  /** 첫 조각의 **재단** 좌상단 */
  x0: number
  y0: number
} {
  // 도련 기능이 꺼져 있으면 저장된 값과 무관하게 맞붙이기다 (`BLEED_ENABLED` 주석 참조)
  const mode = BLEED_ENABLED ? (sheet.bleedMode ?? 'none') : 'none'
  const b = sheetBleed(sheet)
  const each = mode === 'each' ? b : 0
  const gap = sheet.gap

  // 칸 = 재단 크기 + (each 일 때만) 사방 도련
  const cw = size.w + 2 * each
  const ch = size.h + 2 * each
  const stepX = cw + gap
  const stepY = ch + gap

  // 깔 수 있는 칸 수는 도련과 **무관하게** 잡는다.
  // outer 도련 때문에 한 줄을 통째로 잃으면 그게 더 손해다 — 도련은 종이 여백
  // 쪽으로 삐져나가면 되고, 어차피 잘려나갈 부분이다.
  const availX = sheet.w - 2 * sheet.margin
  const availY = sheet.h - 2 * sheet.margin
  const fit = (avail: number, step: number, cell: number) =>
    avail < cell ? 0 : Math.max(0, Math.floor((avail + gap) / step))
  const cols = fit(availX, stepX, cw)
  const rows = fit(availY, stepY, ch)

  // 남는 자리는 좌우/위아래로 나눠 — 가운데 정렬. 종이를 삐뚤게 넣어도 덜 티난다.
  const usedX = cols > 0 ? cols * cw + (cols - 1) * gap : 0
  const usedY = rows > 0 ? rows * ch + (rows - 1) * gap : 0

  // outer 도련이 종이 밖으로 나가면 안 된다. 남는 자리까지만 붙인다.
  // 여백(margin)만큼은 늘 남아 있으므로 도련 ≤ 여백이면 그대로 다 붙는다.
  const slack = Math.max(0, Math.min((sheet.w - usedX) / 2, (sheet.h - usedY) / 2))
  const effective = mode === 'outer' ? Math.min(b, slack) : b

  return {
    cols,
    rows,
    stepX,
    stepY,
    bleed: effective,
    mode,
    // x0 는 «재단» 좌상단이다. each 면 칸 안쪽으로 도련만큼 들어간다.
    x0: (sheet.w - usedX) / 2 + each,
    y0: (sheet.h - usedY) / 2 + each,
  }
}

/** 종이에 깔릴 조각 하나 — 어느 카드이고 어느 틀을 쓰는지 */
interface Piece {
  instance: Instance
  front: Component
  back?: Component
}

/** 수량만큼 펼친 인스턴스 목록 */
export function expand(deck: Deck): Instance[] {
  const out: Instance[] = []
  for (const i of deck.instances) for (let n = 0; n < Math.max(0, i.qty | 0); n++) out.push(i)
  return out
}

/** 덱들을 순서대로 이어 붙여 «깔 조각 목록» 으로 */
function piecesOf(project: Project, decks: Deck[]): Piece[] {
  const out: Piece[] = []
  for (const d of decks) {
    const front = project.components[d.component]
    if (!front) continue
    const back = d.back ? project.components[d.back] : undefined
    for (const instance of expand(d)) out.push({ instance, front, back })
  }
  return out
}

/**
 * 어느 변에 도련이 필요한지.
 *
 * `outer` 에서는 **실제로 깔린 조각들** 의 바깥 테두리가 기준이다.
 * 격자의 마지막 줄이 아니라 «이 쪽에 이웃이 없는가» 로 따진다 —
 * 마지막 장이 반만 차면 거기 바닥이 곧 바깥 테두리이기 때문이다.
 */
function edgesFor(
  mode: 'none' | 'outer' | 'each',
  col: number,
  row: number,
  taken: Set<string>
): Edges {
  if (mode === 'each') return { left: true, top: true, right: true, bottom: true }
  if (mode === 'none') return NO_EDGES
  const has = (c: number, r: number) => taken.has(`${c},${r}`)
  return {
    left: !has(col - 1, row),
    top: !has(col, row - 1),
    right: !has(col + 1, row),
    bottom: !has(col, row + 1),
  }
}

/**
 * 조판한다.
 *
 * 뒷면이 있으면 **앞·뒤·앞·뒤** 순서로 낸다. 수동 양면 인쇄에서 이 순서가
 * 제일 헷갈리지 않고, 양면 프린터에도 그대로 맞는다.
 *
 * 뒷면은 격자를 **좌우로 뒤집는다**. 종이를 긴 쪽으로 넘기면 왼쪽 칸이
 * 오른쪽으로 가기 때문이다. 짧은 쪽으로 넘기면 상하까지 뒤집는다.
 */
export function impose(project: Project, deck: Deck): Plan {
  return imposeDecks(project, [deck])
}

/**
 * 여러 덱을 **한 종이에 이어서** 조판한다 (인쇄 묶기).
 *
 * 덱마다 따로 뽑으면 마지막 장이 늘 반쯤 빈다. 이어 깔면 그 빈 칸을 다음 덱이
 * 채운다 — 종이가 줄고, 시제품을 여러 번 뽑는 초기 단계에서는 그 차이가 크다.
 *
 * **규격·종이 설정은 첫 덱을 따른다.** 칸 크기가 다른 덱을 섞으면 한 격자에
 * 깔 수 없으므로 부르는 쪽에서 미리 걸러야 한다 (`sameSize`).
 * 뒷면은 덱마다 다를 수 있어 **칸이 자기 뒷면을 들고 간다.**
 */
export function imposeDecks(project: Project, decks: Deck[]): Plan {
  const first = decks[0]
  const c: Component | undefined = first && project.components[first.component]
  if (!first || !c) return emptyPlan(first?.sheet ?? { w: 210, h: 297, margin: 10, gap: 0, marks: 'crop' })

  const sheet = first.sheet
  const g = layout(c.size, sheet)
  const per = g.cols * g.rows
  const items = piecesOf(project, decks)
  const pages: Page[] = []

  if (per === 0 || items.length === 0) {
    return { ...basePlan(g, c.size, sheet), pages }
  }

  // 뒷면을 찍을지는 **묶음 전체**로 정한다. 한 장 안에서 어떤 칸만 뒤집을 수는 없다.
  const duplex = first.duplex
  const anyBack = items.some((it) => it.back)
  const flipY = duplex === 'short'
  // 뒤집는 것이 기본이다. 끌 수 있는 이유는 `Deck.mirrorBack` 주석 참조 —
  // 어긋났을 때 반대 버전을 뽑아 대보는 것이 원인을 캐는 것보다 빠르다.
  const mirror = first.mirrorBack !== false
  let no = 0

  for (let start = 0; start < items.length; start += per) {
    const slice = items.slice(start, start + per)
    const at = (i: number) => ({ col: i % g.cols, row: Math.floor(i / g.cols) })
    const place = (spots: { col: number; row: number }[]): Cell[] => {
      const taken = new Set(spots.map((p) => `${p.col},${p.row}`))
      return spots.map((p, i) => ({
        x: g.x0 + p.col * g.stepX,
        y: g.y0 + p.row * g.stepY,
        instance: slice[i]!.instance,
        front: slice[i]!.front,
        back: slice[i]!.back,
        col: p.col,
        row: p.row,
        edges: edgesFor(g.mode, p.col, p.row, taken),
      }))
    }

    no++
    pages.push({ no, side: 'front', cells: place(slice.map((_, i) => at(i))) })

    if (anyBack && duplex) {
      pages.push({
        no,
        side: 'back',
        cells: place(
          slice.map((_, i) => {
            const { col, row } = at(i)
            return {
              col: mirror ? g.cols - 1 - col : col,
              row: flipY ? g.rows - 1 - row : row,
            }
          })
        ),
      })
    }
  }

  return { ...basePlan(g, c.size, sheet), pages }
}

/** 한 격자에 같이 깔 수 있는가 — 규격이 같아야 한다 */
export function sameSize(project: Project, a: Deck, b: Deck): boolean {
  const x = project.components[a.component]?.size
  const y = project.components[b.component]?.size
  return !!x && !!y && x.w === y.w && x.h === y.h && x.shape === y.shape
}

function basePlan(
  g: ReturnType<typeof layout>,
  size: PieceSize,
  sheet: SheetSpec
): Omit<Plan, 'pages'> {
  // 자를 위치 = 조각의 재단 경계. 도련이 어떻든 여기는 안 움직인다.
  const cutsX: number[] = []
  const cutsY: number[] = []
  for (let i = 0; i < g.cols; i++) {
    const x = g.x0 + i * g.stepX
    cutsX.push(x, x + size.w)
  }
  for (let i = 0; i < g.rows; i++) {
    const y = g.y0 + i * g.stepY
    cutsY.push(y, y + size.h)
  }
  return {
    piece: { w: size.w, h: size.h },
    bleed: g.bleed,
    bleedMode: g.mode,
    cols: g.cols,
    rows: g.rows,
    sheet,
    // 맞붙였으면 같은 자리가 두 번 나온다 — 한 번만 긋는다
    cutsX: dedupe(cutsX),
    cutsY: dedupe(cutsY),
  }
}

function emptyPlan(sheet: SheetSpec): Plan {
  return {
    pages: [],
    piece: { w: 0, h: 0 },
    bleed: 0,
    bleedMode: sheet.bleedMode ?? 'none',
    cols: 0,
    rows: 0,
    sheet,
    cutsX: [],
    cutsY: [],
  }
}

/** 0.01mm 안쪽이면 같은 자리로 본다 */
function dedupe(xs: number[]): number[] {
  const out: number[] = []
  for (const x of [...xs].sort((a, b) => a - b)) {
    if (!out.length || Math.abs(out[out.length - 1]! - x) > 0.01) out.push(x)
  }
  return out
}
