/**
 * 보드 조판 — **한 장짜리 큰 인쇄물**을 종이에 앉힌다.
 *
 * `impose.ts` 와 방향이 정반대다. 저쪽은 «작은 조각을 종이에 여러 개 깔고 잘라내는»
 * 문제고, 여기는 «종이보다 큰 한 장을 나눠 뽑아 이어 붙이는» 문제다.
 * 그래서 격자도 도련도 재단선도 없다. 대신 **겹침(풀칠 여유)** 이 있다.
 *
 * `impose.ts` 와 마찬가지로 순수 함수다. DOM 을 모른다. 단위는 전부 mm.
 */

import type { Board, PieceSize, SheetSpec } from './model.ts'

/** 이웃한 장이 붙는 변. 여기에 풀칠 표시를 그린다. */
export interface TileEdges {
  left: boolean
  right: boolean
  top: boolean
  bottom: boolean
}

export interface TilePage {
  /** 1 부터 */
  no: number
  col: number
  row: number
  /**
   * 이 장이 담는 **판 위의 영역** (판 좌상단 기준).
   * 그릴 때는 판 전체를 `-x, -y` 만큼 밀어놓고 이 상자로 잘라내면 된다.
   */
  x: number
  y: number
  w: number
  h: number
  /**
   * **종이 위** 어디에 이 영역을 놓을지 (종이 좌상단 기준).
   *
   * 한 장에 그대로 뽑을 때는 **여백을 쓰지 않고 가운데** 앉힌다 —
   * 판은 격자로 깔아 잘라내는 물건이 아니라서 여백이 «자를 자리» 가 아니다.
   * 여백만큼 밀어놓으면 종이와 같은 크기의 판이 그 폭만큼 잘려 나간다
   * (A3 판을 A3 종이에 뽑을 때 실제로 그랬다).
   * 나눠 뽑을 때는 여백 자리에서 시작한다 — 그쪽은 프린터가 못 찍는 가장자리를 피해야 한다.
   */
  px: number
  py: number
  /** 이 장에 이웃이 붙는 변 — 그 변에 겹침 폭만큼 풀칠 자리가 있다 */
  edges: TileEdges
}

export interface TilePlan {
  sheet: SheetSpec
  /** 판의 실물 크기 */
  board: { w: number; h: number }
  cols: number
  rows: number
  /** 종이 한 장이 담는 판 영역 (= 인쇄 가능 폭). 마지막 장도 이 크기로 잡힌다 */
  spanW: number
  spanH: number
  /** 실제로 적용된 겹침. 요청값 이상이다 (아래 `step` 주석 참조) */
  overlapX: number
  overlapY: number
  /** 판이 종이 한 장에 그대로 들어가는가 */
  single: boolean
  /**
   * 한 장에 그대로 뽑으라고 했는데 종이보다 큰 상태.
   * 미리보기가 이걸 보고 «잘려 나갑니다» 를 띄운다.
   */
  overflow: boolean
  pages: TilePage[]
}

/** 판을 종이 한 장에 그대로 (`tiling: 'single'`) */
function singlePage(size: PieceSize, sheet: SheetSpec): TilePlan {
  const availW = sheet.w - 2 * sheet.margin
  const availH = sheet.h - 2 * sheet.margin
  // 가운데 앉힌다. 종이보다 크면 음수가 되어 **양쪽이 고르게** 넘친다 —
  // 한쪽만 잘리면 «중앙이 밀렸다» 로 보여서 원인을 찾기 어렵다.
  const px = (sheet.w - size.w) / 2
  const py = (sheet.h - size.h) / 2
  return {
    sheet,
    board: { w: size.w, h: size.h },
    cols: 1,
    rows: 1,
    spanW: size.w,
    spanH: size.h,
    overlapX: 0,
    overlapY: 0,
    // **여백 안쪽까지 들어가는가.** 여기까지면 어떤 프린터로도 안전하다.
    single: size.w <= availW + 1e-9 && size.h <= availH + 1e-9,
    // 종이 자체를 넘으면 진짜로 잘린다. 여백만 침범하는 건 봐준다 —
    // 여백은 «자를 자리» 가 아니라 «프린터가 못 찍을 수도 있는 가장자리» 라
    // 판에 대해서는 경고지 금지가 아니다.
    overflow: size.w > sheet.w + 1e-9 || size.h > sheet.h + 1e-9,
    pages: [
      {
        no: 1,
        col: 0,
        row: 0,
        x: 0,
        y: 0,
        w: size.w,
        h: size.h,
        px,
        py,
        edges: { left: false, right: false, top: false, bottom: false },
      },
    ],
  }
}

/**
 * 한 축의 분할.
 *
 * 요청한 겹침으로 **몇 장이 필요한지**부터 정하고, 그 장수에 맞춰 **겹침을 다시
 * 고르게 편다.** 그냥 `step = span - overlap` 으로 쭉 깔면 마지막 장이 손톱만큼만
 * 차서 «거의 빈 종이 한 장» 이 나오는데, 장수는 이미 정해졌으므로 그 여유를
 * 이음매마다 나눠주면 **모든 장이 꽉 차고 겹침만 넉넉해진다.** 붙이기도 쉬워진다.
 */
function axis(total: number, span: number, overlap: number): { n: number; step: number; over: number } {
  if (total <= span + 1e-9) return { n: 1, step: span, over: 0 }
  // 겹침이 종이만큼 크면 아무리 깔아도 안 나아간다. 절반까지만 받는다.
  const ov = Math.max(0, Math.min(overlap, span / 2))
  const n = Math.max(2, Math.ceil((total - ov) / (span - ov)))
  // n 장으로 total 을 덮으려면 이음매 (n-1) 개가 이만큼씩 나아가면 된다
  const step = (total - span) / (n - 1)
  return { n, step, over: span - step }
}

/** 보드를 종이에 앉힌다 */
export function tileBoard(size: PieceSize, sheet: SheetSpec, board?: Board): TilePlan {
  const mode = board?.tiling ?? 'single'
  if (mode !== 'tile') return singlePage(size, sheet)

  const spanW = Math.max(1, sheet.w - 2 * sheet.margin)
  const spanH = Math.max(1, sheet.h - 2 * sheet.margin)
  const want = board?.overlap ?? 10
  const X = axis(size.w, spanW, want)
  const Y = axis(size.h, spanH, want)

  const pages: TilePage[] = []
  let no = 1
  for (let row = 0; row < Y.n; row++) {
    for (let col = 0; col < X.n; col++) {
      pages.push({
        no: no++,
        col,
        row,
        x: col * X.step,
        y: row * Y.step,
        w: spanW,
        h: spanH,
        px: sheet.margin,
        py: sheet.margin,
        edges: {
          left: col > 0,
          right: col < X.n - 1,
          top: row > 0,
          bottom: row < Y.n - 1,
        },
      })
    }
  }

  return {
    sheet,
    board: { w: size.w, h: size.h },
    cols: X.n,
    rows: Y.n,
    spanW,
    spanH,
    overlapX: X.over,
    overlapY: Y.over,
    single: X.n === 1 && Y.n === 1,
    overflow: false,
    pages,
  }
}
