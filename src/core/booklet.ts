/**
 * 룰북 조판 — **쪽을 종이에 앉힌다.**
 *
 * 덱 조판(`impose.ts`)·보드 타일링(`tile.ts`)과 방향이 또 다르다.
 *   덱은 «작은 조각을 격자로 깔고 자른다» — 순서가 상관없다.
 *   보드는 «큰 한 장을 나눠 뽑아 붙인다» — 이웃과 겹쳐야 한다.
 *   룰북은 «작은 쪽이 순서대로» — **자를 것도 붙일 것도 없고 순서가 전부다.**
 *
 * 여기서 실제로 어려운 건 하나뿐이다. **중철(접어서 묶기)의 쪽 순서**다.
 *
 *   8쪽짜리를 A4 두 장에 접어 만들면 종이에는 이렇게 깔린다:
 *
 *     1장 앞 [ 8 | 1 ]      1장 뒤 [ 2 | 7 ]
 *     2장 앞 [ 6 | 3 ]      2장 뒤 [ 4 | 5 ]
 *
 *   두 장을 겹쳐 반으로 접으면 1-2-3-4-5-6-7-8 이 된다. 사람이 이 표를 손으로
 *   만들면 8쪽까지는 되고 16쪽부터 반드시 틀린다 — 그래서 여기서 계산한다.
 *
 * **총 쪽수는 4의 배수여야 한다.** 종이 한 장이 네 쪽(앞2·뒤2)을 물고 있기 때문이다.
 * 모자라면 백지로 채운다 (`page: null`).
 */

import type { PieceSize, Rulebook, SheetSpec } from './model.ts'

/** 종이 한 면의 한 자리 */
export interface BookSlot {
  /** 쪽 번호 (1부터). `null` 이면 백지 */
  page: number | null
  /** mm, 종이 좌상단 기준 */
  x: number
  y: number
}

export interface BookSheet {
  /** 종이 몇 번째 장인지 (1부터) */
  no: number
  side: 'front' | 'back'
  slots: BookSlot[]
}

export interface BookPlan {
  sheet: SheetSpec
  page: { w: number; h: number }
  binding: 'saddle' | 'staple'
  duplex: boolean
  /** 종이 한 면에 몇 쪽이 앉는지 (중철 2, 모서리 스테이플 1) */
  perSide: number
  /** 원고 쪽수 */
  count: number
  /** 백지까지 넣은 쪽수 */
  padded: number
  sheets: BookSheet[]
  /** 접는 선의 x (mm). 중철에서만 */
  foldX?: number
  /** 쪽이 종이에 안 들어간다 */
  overflow: boolean
}

/** 이 제본으로 종이 한 면에 몇 쪽이 앉나 */
export const perSideOf = (binding: 'saddle' | 'staple'): number => (binding === 'saddle' ? 2 : 1)

/**
 * 중철 한 장의 쪽 번호.
 *
 * `i` 는 바깥에서 안쪽으로 세는 종이 번호(0부터).
 * 바깥 장일수록 «첫 쪽과 마지막 쪽» 을 물고, 안쪽으로 갈수록 가운데 쪽을 문다.
 */
export function saddleSheet(total: number, i: number): { front: [number, number]; back: [number, number] } {
  return {
    front: [total - 2 * i, 1 + 2 * i],
    back: [2 + 2 * i, total - 1 - 2 * i],
  }
}

/**
 * 조판한다.
 *
 * 쪽은 종이 **가운데**에 앉힌다. 여백을 한쪽으로 몰면 접었을 때 등이 안 맞는다.
 * 여백(`sheet.margin`)은 여기서 쓰지 않는다 — 룰북의 여백은 «쪽 안» 의 문제이고
 * (본문 상자를 안쪽으로 넣으면 된다), 종이 여백을 또 주면 두 번 들어간다.
 */
export function planBook(size: PieceSize, sheet: SheetSpec, book: Pick<Rulebook, 'binding' | 'duplex' | 'pages'>): BookPlan {
  const binding = book.binding ?? 'saddle'
  const perSide = perSideOf(binding)
  const duplex = binding === 'saddle' ? book.duplex !== false : !!book.duplex
  const count = book.pages.length
  const page = { w: size.w, h: size.h }

  const spanW = page.w * perSide
  const overflow = spanW > sheet.w + 1e-9 || page.h > sheet.h + 1e-9
  const x0 = (sheet.w - spanW) / 2
  const y0 = (sheet.h - page.h) / 2

  const sheets: BookSheet[] = []
  const at = (n: number | null, slot: number): BookSlot => ({
    // 원고에 없는 쪽은 백지. 마지막 장이 반쯤 비는 건 정상이다
    page: n !== null && n >= 1 && n <= count ? n : null,
    x: x0 + slot * page.w,
    y: y0,
  })

  if (binding === 'saddle') {
    const padded = Math.max(4, Math.ceil(count / 4) * 4)
    for (let i = 0; i < padded / 4; i++) {
      const s = saddleSheet(padded, i)
      sheets.push({ no: i + 1, side: 'front', slots: [at(s.front[0], 0), at(s.front[1], 1)] })
      if (duplex) sheets.push({ no: i + 1, side: 'back', slots: [at(s.back[0], 0), at(s.back[1], 1)] })
    }
    return { sheet, page, binding, duplex, perSide, count, padded, sheets, foldX: sheet.w / 2, overflow }
  }

  // 모서리 스테이플 — 한 면에 한 쪽씩, 그냥 차례대로.
  // 양면이면 한 장이 두 쪽(앞·뒤)을 문다.
  const padded = duplex ? Math.ceil(count / 2) * 2 : count
  const step = duplex ? 2 : 1
  for (let n = 1, no = 1; n <= Math.max(padded, 1); n += step, no++) {
    sheets.push({ no, side: 'front', slots: [at(n, 0)] })
    if (duplex) sheets.push({ no, side: 'back', slots: [at(n + 1, 0)] })
  }
  return { sheet, page, binding, duplex, perSide, count, padded, sheets, overflow }
}

/**
 * 이 룰북에 어울리는 종이.
 *
 * 중철이면 **쪽 두 개가 나란히 들어가는** 종이여야 한다 — A5 룰북에 A4 세로를
 * 골라두면 두 쪽이 안 들어가 조용히 한 쪽만 나온다. 목록에서 자동으로 짚어준다.
 */
export function suggestSheet(
  size: PieceSize,
  binding: 'saddle' | 'staple',
  presets: { name: string; w: number; h: number }[]
): { name: string; w: number; h: number } | undefined {
  const needW = size.w * perSideOf(binding)
  return presets
    .filter((p) => needW <= p.w + 1e-9 && size.h <= p.h + 1e-9)
    .sort((a, b) => a.w * a.h - b.w * b.h)[0]
}
