/**
 * 확인 모음 — 이번까지 만든 것들이 여전히 맞는지 한 번에 돌린다.
 *
 *   npm run check
 *
 * 브라우저가 있어야 하는 부분은 **여기서 못 본다**:
 *   IndexedDB(그림·글꼴 저장) · FontFace(글꼴 등록) · SVG 래스터화(PNG 실제 생성) ·
 *   인쇄 대화상자. 그건 사람이 띄워서 봐야 한다 (README «아직 아닌 것» 참조).
 *
 * 테스트 틀을 따로 들이지 않았다. 의존성 셋(react·react-dom·zustand)을 지키는 게
 * 이 프로젝트의 성격에 맞고, 이 정도 규모에서는 이걸로 충분하다.
 */

// 브라우저 흉내 — 아래 코드가 건드리는 최소한만
;(globalThis as any).getComputedStyle = () => ({
  getPropertyValue: (v: string) => (v === '--hd-sans' ? "'Malgun Gothic', sans-serif" : "'Batang', serif"),
})
const lsStore: Record<string, string> = {}
;(globalThis as any).localStorage = {
  getItem: (k: string) => lsStore[k] ?? null,
  setItem: (k: string, v: string) => {
    lsStore[k] = v
  },
  removeItem: (k: string) => {
    delete lsStore[k]
  },
}
;(globalThis as any).document = {
  documentElement: {},
  createElement: () => ({ style: {}, getBoundingClientRect: () => ({ width: 377.95 }), remove() {} }),
  body: { appendChild() {} },
}

import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { colorAlpha, gradientAlpha, hitLayer, pickLayer } from '../src/core/hit.ts'
import { impose, imposeDecks, layout, sameSize } from '../src/core/impose.ts'
import { chipHeight, expandForBleed, fontStack, gradientCss, Piece, styleText } from '../src/core/render.tsx'
import { buildSvg } from '../src/core/png.ts'
import { crc32, unzip, zipBytes } from '../src/core/zip.ts'
import { buildBundleBytes, looksLikeZip, parseBundle } from '../src/core/bundle.ts'
import { faceWeight } from '../src/store/fonts.ts'
import { Ruler } from '../src/ui/Ruler.tsx'
import { useStore } from '../src/store/project.ts'
import { tileBoard } from '../src/core/tile.ts'
import { planBook, suggestSheet } from '../src/core/booklet.ts'
import { parseInline, parseMarkdown } from '../src/core/markdown.ts'
import {
  BODY_LAYER,
  bodyFit,
  buildRulebook,
  FOLIO_LAYER,
  parseRulebookSource,
  TITLE_LAYER,
} from '../src/core/rulebook.ts'
import { A3, A4, BLEED_ENABLED, checkDeckJson, deckToJson, groupColor, printSet, SHEET_PRESETS, totalPieces, type Board, type Component, type Keyword, type Layer, type PieceSize, type Project, type SheetSpec } from '../src/core/model.ts'

let fail = 0
let pass = 0
const ok = (n: string, c: boolean, x?: unknown) => {
  if (c) pass++
  else {
    fail++
    console.log(`FAIL  ${n}${x === undefined ? '' : `  <- ${JSON.stringify(x)}`}`)
  }
}
const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) < e
const group = (n: string) => console.log(`— ${n}`)

// ─────────────────────────────────────────── 히트 테스트
group('히트 테스트 — 투명한 곳은 뒤가 잡힌다')
ok('rgba 알파', colorAlpha('rgba(0,0,0,.75)') === 0.75)
ok('슬래시 표기', colorAlpha('rgb(0 0 0 / 50%)') === 0.5)
ok('이름 색은 불투명', colorAlpha('white') === 1)
const scrim = ['rgba(0,0,0,0)', 'rgba(0,0,0,.75)']
ok('그늘 위쪽은 빈 곳', gradientAlpha(scrim, 'to bottom', 30, 0.2, 63, 30) < 0.03)
ok('그늘 아래쪽은 칠해짐', gradientAlpha(scrim, 'to bottom', 30, 29.5, 63, 30) > 0.7)
ok(
  '빈 줄이 섞여도 판정은 같다',
  near(
    gradientAlpha(['rgba(0,0,0,0)', '', 'rgba(0,0,0,.75)'], 'to bottom', 30, 29.5, 63, 30),
    gradientAlpha(scrim, 'to bottom', 30, 29.5, 63, 30)
  )
)
const ring: Layer = { id: 'r', name: '테', kind: 'rect', x: 10, y: 10, w: 40, h: 40, stroke: '#000', strokeWidth: 1 }
ok('빈 테두리 도형 안쪽은 통과', !hitLayer(ring, { x: 30, y: 30 }, undefined))
ok('선 위는 잡힘', hitLayer(ring, { x: 10.3, y: 30 }, undefined))
const round: Layer = { id: 'c', name: '원', kind: 'rect', x: 0, y: 0, w: 20, h: 20, fill: '#f00', radius: 10 }
ok('원의 모서리 밖은 통과', !hitLayer(round, { x: 0.5, y: 0.5 }, undefined))
const img: Layer = { id: 'i', name: '그림', kind: 'image', x: 0, y: 0, w: 20, h: 10, fit: 'fill', asset: 'a1' }
ok('그림 투명 화소는 통과', !hitLayer(img, { x: 15, y: 5 }, undefined, { alpha: () => ({ w: 2, h: 1, a: new Uint8Array([255, 0]) }) }))
ok('알파를 모르면 상자 전체 (동작이 퇴화하지 않는다)', hitLayer(img, { x: 15, y: 5 }, undefined, {}))
const contain: Layer = { id: 'i2', name: '그림', kind: 'image', x: 0, y: 0, w: 20, h: 20, fit: 'contain', asset: 'a1' }
const opaque = { alpha: () => ({ w: 2, h: 1, a: new Uint8Array([255, 255]) }) }
ok('contain 여백은 통과', !hitLayer(contain, { x: 10, y: 1 }, undefined, opaque))
const txt: Layer = { id: 't', name: 'T', kind: 'text', x: 0, y: 0, w: 60, h: 20, text: '이름' }
const boxes = { textBoxes: () => [{ x: 20, y: 6, w: 20, h: 8 }] }
ok('글자 없는 여백은 통과', !hitLayer(txt, { x: 3, y: 10 }, undefined, boxes))
ok('빈 글자 자리는 잡힌다', hitLayer({ ...txt, text: '' } as Layer, { x: 3, y: 10 }, undefined, boxes))
const bg: Layer = { id: 'bg', name: '배경', kind: 'image', x: 0, y: 0, w: 63, h: 88, fit: 'fill', asset: 'a1' }
const probe = { alpha: opaque.alpha, textBoxes: boxes.textBoxes }
ok('글자 여백을 누르면 뒤 배경', pickLayer([bg, txt], { x: 3, y: 10 }, undefined, null, probe)?.id === 'bg')
ok('고른 레이어의 투명부는 계속 잡힌다', pickLayer([bg, txt], { x: 3, y: 10 }, undefined, 't', probe)?.id === 't')
ok('위에 덮인 건 그래도 이긴다', pickLayer([bg, txt], { x: 30, y: 10 }, undefined, 'bg', probe)?.id === 't')
ok('Ctrl 클릭은 투명 무시', pickLayer([bg, txt], { x: 3, y: 10 }, undefined, null, probe, true)?.id === 't')
ok('숨긴 레이어는 안 잡힌다', pickLayer([{ ...bg, hidden: true } as Layer], { x: 3, y: 10 }, undefined, null, probe) === null)

// ─────────────────────────────────────────── 조판·도련
group('조판 — 도련은 카드가 아니라 인쇄물의 것')
const size = { w: 63, h: 88, shape: 'rect' as const }
const sheet = (o: Partial<SheetSpec>): SheetSpec => ({ ...A4, ...o })
ok('조각 규격에 bleed 가 없다', !('bleed' in size))

// 도련은 지금 꺼져 있다. 저장된 값이 무엇이든 «맞붙이기» 로 나와야 한다.
// (켜면 아래 기대값이 바뀐다 — 그때 이 묶음을 같이 손본다)
ok('기능이 꺼져 있다', BLEED_ENABLED === false)
for (const m of ['none', 'outer', 'each'] as const) {
  const g = layout(size, sheet({ bleedMode: m, bleed: 3 }))
  ok(`${m}: 꺼져 있으면 도련 0`, g.bleed === 0 && g.mode === 'none', g)
  ok(`${m}: A4 에 3×3 그대로`, g.cols === 3 && g.rows === 3, g)
  ok(`${m}: 칸 간격은 재단 크기`, near(g.stepX, 63) && near(g.stepY, 88))
}
const proj = (n: number, mode: SheetSpec['bleedMode'] = 'none'): Project => ({
  handeck: 1,
  name: 't',
  components: {
    c1: { id: 'c1', name: 'c', size, background: '#fff', layers: [{ id: 'art', name: '그림', kind: 'image', x: 0, y: 0, w: 63, h: 88 }] },
  },
  decks: [{ id: 'd', name: 'd', component: 'c1', sheet: sheet({ bleedMode: mode, bleed: 3 }), duplex: false, instances: [{ id: 'i', qty: n, values: {} }] }],
})
const saved = proj(9, 'outer')
ok(
  '예전에 outer 로 저장한 프로젝트도 도련 없이 나온다',
  impose(saved, saved.decks[0]!).pages[0]!.cells.every((c) => Object.values(c.edges).every((v) => !v))
)
const p9 = proj(9)
const cells = impose(p9, p9.decks[0]!).pages[0]!.cells
ok('9장이 한 장에 3×3', cells.length === 9)
ok('맞붙는다 — 둘째 칸 x = 첫 칸 + 63', near(cells[1]!.x - cells[0]!.x, 63))
ok('3칸 맞붙이면 재단선 4줄', impose(p9, p9.decks[0]!).cutsX.length === 4)

// 늘리는 계산 자체는 그대로 둔다 (순수 함수라 기능을 꺼도 맞는지 볼 수 있다).
// 다시 켤 때 여기부터 보면 된다.
const c1 = proj(1).components.c1!
const grown = expandForBleed(c1, 3, { left: true, top: true, right: false, bottom: false })
ok('지정한 변만 늘어난다', grown.size.w === 66 && grown.size.h === 91)
ok('가장자리에 닿은 레이어가 늘어난다', grown.layers[0]!.w === 66 && grown.layers[0]!.x === 0)
ok('도련 0 이면 원본 그대로', expandForBleed(c1, 0, { left: true, top: true, right: true, bottom: true }) === c1)

// 양면 — 뒷면 격자를 좌우로 뒤집는다. 끌 수도 있어야 한다 (드라이버가 제각각이라)
{
  const dup = (mirrorBack?: boolean): Project => {
    const base = proj(4)
    return {
      ...base,
      components: {
        ...base.components,
        c2: { id: 'c2', name: 'b', size, background: '#000', layers: [] },
      },
      decks: [{ ...base.decks[0]!, back: 'c2', duplex: 'long', ...(mirrorBack === undefined ? {} : { mirrorBack }) }],
    }
  }
  const colsOf = (p: Project) =>
    impose(p, p.decks[0]!)
      .pages.filter((x) => x.side === 'back')[0]!
      .cells.map((c) => c.col)
  // A4 에 63×88 이면 3열이다. 앞면 0,1,2,0 → 뒷면 2,1,0,2
  ok('기본은 좌우 뒤집기', JSON.stringify(colsOf(dup())) === JSON.stringify([2, 1, 0, 2]), colsOf(dup()))
  ok('끄면 앞면과 같은 자리', JSON.stringify(colsOf(dup(false))) === JSON.stringify([0, 1, 2, 0]), colsOf(dup(false)))
  ok('켜면 기본과 같다', JSON.stringify(colsOf(dup(true))) === JSON.stringify(colsOf(dup())))
}

// ─────────────────────────────────────────── 보드 조판
group('보드 — A3 는 A3 로, 안 되면 나눠 뽑는다')
{
  const board = (o: Partial<Board> = {}): Board => ({
    id: 'b',
    name: 'b',
    component: 'c1',
    sheet: { ...A3 },
    tiling: 'single',
    overlap: 10,
    ...o,
  })
  const A3size = { w: 297, h: 420, shape: 'rect' as const }
  const A4size = { w: 210, h: 297, shape: 'rect' as const }

  // ① 한 장에 그대로 — A3 판을 A3 종이에
  const t1 = tileBoard(A3size, { ...A3 }, board())
  ok('A3 판 + A3 종이 = 한 쪽', t1.pages.length === 1, t1.pages.length)
  ok('A3 를 A3 로 뽑으면 종이도 A3', t1.sheet.w === 297 && t1.sheet.h === 420)
  // 여백(10mm) 안쪽에는 안 들어가지만 종이 밖으로 나가지도 않는다 —
  // 가장자리까지 못 찍는 프린터를 위해 경고만 하고 막지는 않는다
  ok('여백을 넘지만 잘리지는 않는다', t1.single === false && t1.overflow === false, t1)
  // ⚠️ 여기서 실제로 틀렸었다 — 여백 자리에서 시작하는 바람에 A3 판을 A3 종이에
  // 뽑으면 오른쪽·아래가 10mm 씩 잘려 나갔다. 판은 **가운데** 앉혀야 한다.
  ok('종이와 같은 크기면 딱 맞게 앉는다 (여백에 밀리지 않는다)', t1.pages[0]!.px === 0 && t1.pages[0]!.py === 0, t1.pages[0])

  const t1b = tileBoard({ w: 200, h: 300, shape: 'rect' }, { ...A3 }, board())
  ok('작은 판은 가운데로', near(t1b.pages[0]!.px, (297 - 200) / 2) && near(t1b.pages[0]!.py, (420 - 300) / 2))

  // ② 종이보다 큰 판을 한 장에 = 잘린다. 이건 반드시 경고여야 한다
  const t2 = tileBoard(A3size, { ...A4 }, board({ sheet: { ...A4 } }))
  ok('A3 판을 A4 한 장에 = 잘림 경고', t2.overflow === true)
  ok('넘칠 때는 사방이 고르게 넘친다', t2.pages[0]!.px < 0 && t2.pages[0]!.py < 0, t2.pages[0])
  // 300×300 은 A3 짧은 변(297)보다 3mm 크다 — 돌려도 안 들어간다. 실제로 부딪힌 경우다
  ok('300×300 은 A3 어느 방향으로도 안 들어간다', tileBoard({ w: 300, h: 300, shape: 'rect' }, { ...A3, w: 420, h: 297 }, board()).overflow === true)

  // ③ 나눠 뽑기 — A3 판을 A4 로
  const t3 = tileBoard(A3size, { ...A4 }, board({ sheet: { ...A4 }, tiling: 'tile' }))
  ok('A3 판 → A4 여러 장', t3.pages.length > 1, t3.pages.length)
  ok('나눠 뽑을 땐 잘림 경고가 없다', t3.overflow === false)
  // 빠짐없이 덮는가 — 마지막 장의 오른쪽·아래가 판 끝에 닿아야 한다
  const last = t3.pages.at(-1)!
  ok('가로를 끝까지 덮는다', last.x + t3.spanW >= A3size.w - 1e-9, { x: last.x, span: t3.spanW })
  ok('세로를 끝까지 덮는다', last.y + t3.spanH >= A3size.h - 1e-9, { y: last.y, span: t3.spanH })
  ok('요청한 겹침 이상으로 겹친다', t3.overlapX >= 10 - 1e-9 && t3.overlapY >= 10 - 1e-9, {
    x: t3.overlapX,
    y: t3.overlapY,
  })
  // 이웃이 있는 변에만 풀칠 표시가 붙는다 (첫 장은 왼쪽·위가 바깥이다)
  const first = t3.pages[0]!
  ok('첫 장은 왼쪽·위에 이웃이 없다', !first.edges.left && !first.edges.top)
  // 나눠 뽑을 때는 반대로 **여백 자리에서** 시작한다 (프린터가 못 찍는 가장자리를 피한다)
  ok('나눠 뽑으면 여백 자리에서 시작한다', first.px === A4.margin && first.py === A4.margin)
  ok('마지막 장은 오른쪽·아래에 이웃이 없다', !last.edges.right && !last.edges.bottom)

  // ④ 나눠 뽑기를 켰지만 실은 한 장에 들어가는 경우 — 쓸데없이 나누지 않는다
  const t4 = tileBoard({ w: 150, h: 200, shape: 'rect' }, { ...A4 }, board({ sheet: { ...A4 }, tiling: 'tile' }))
  ok('들어가면 안 나눈다', t4.pages.length === 1 && t4.single === true)

  // ⑤ 겹침이 종이보다 크면 아무리 깔아도 안 나아간다 — 절반에서 막는다
  const t5 = tileBoard(A4size, { ...A4, w: 100, h: 100 }, board({ sheet: { ...A4, w: 100, h: 100 }, tiling: 'tile', overlap: 999 }))
  ok('말도 안 되는 겹침에도 끝난다', t5.pages.length > 0 && t5.pages.length < 100, t5.pages.length)
}

// ─────────────────────────────────────────── 그늘
group('그늘 — 고치는 중에 사라지지 않는다')
;(globalThis as any).CSS = undefined
ok('CSS.supports 가 없어도 그린다', !!gradientCss(scrim, 'to bottom'))
ok('단계 하나면 같은 색 두 번', gradientCss(['rgba(0,0,0,.5)'], 'to bottom') === 'linear-gradient(to bottom, rgba(0,0,0,.5), rgba(0,0,0,.5))')
ok('빈 줄은 무시하고 그린다', gradientCss(['rgba(0,0,0,0)', '', 'rgba(0,0,0,.75)'], 'to bottom') === 'linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,.75))')
ok('전부 비면 안 그린다', gradientCss([''], 'to bottom') === undefined)
ok('방향이 없으면 to bottom', gradientCss(scrim, undefined)!.startsWith('linear-gradient(to bottom,'))

// ─────────────────────────────────────────── 글꼴·키워드
group('글꼴 · 키워드')
ok('불러온 글꼴은 따옴표 + 대체', fontStack('Noto Sans KR') === '"Noto Sans KR", var(--hd-sans)')
ok('한글 이름', fontStack('나눔명조') === '"나눔명조", var(--hd-sans)')
ok('기존 var() 는 그대로', fontStack('var(--hd-serif)') === 'var(--hd-serif)')
ok('없으면 기본', fontStack(undefined) === 'var(--hd-sans)')
const kws: Keyword[] = [
  { id: 'a', word: '돌진', style: 'bold' },
  { id: 'b', word: '연속 돌진', style: 'chip', bg: '#111111' },
]
const kw = (t: string) => renderToStaticMarkup(<>{styleText(t, kws)}</>)
ok('긴 낱말이 통째로 잡힌다', kw('연속 돌진 발동').includes('>연속 돌진</span>'))
ok('그때 칩 스타일', kw('연속 돌진 발동').includes('background:#111111'))
ok('짧은 쪽도 따로 잡힌다', kw('돌진 발동').includes('font-weight:800'))
ok('없는 낱말은 그대로', kw('평범한 글') === '평범한 글')
// 칩이 줄간격을 밀지 않아야 한다 — 칩 높이(0.86 × 1.3 ≒ 1.12em)가 흔한 줄간격(1.4)보다 낮다
const chipHtml = kw('연속 돌진')
const sizeOf = (h: string) => Number(/font-size:([\d.]+)em/.exec(h)?.[1])
/** `padding: 위 좌우 아래` 를 본문 기준으로 되돌린다 */
const padOf = (h: string) => {
  const m = /padding:([\d.]+)em ([\d.]+)em ([\d.]+)em/.exec(h)!
  const s = sizeOf(h)
  return { top: Number(m[1]) * s, x: Number(m[2]) * s, bottom: Number(m[3]) * s }
}
ok('칩 글씨를 본문보다 줄인다', sizeOf(chipHtml) < 1, sizeOf(chipHtml))
ok('높이는 line-height 가 아니라 여백으로 만든다', /line-height:1[;"]/.test(chipHtml), chipHtml)
ok('위·아래 여백을 따로 준다', /padding:[\d.]+em [\d.]+em [\d.]+em/.test(chipHtml), chipHtml)
ok('칩 전체 높이가 본문 줄간격(1.4)보다 낮다', chipHeight() < 1.4, chipHeight())
ok('계산한 높이와 실제 CSS 가 맞는다', near(sizeOf(chipHtml) + padOf(chipHtml).top + padOf(chipHtml).bottom, chipHeight(), 1e-3))
ok('위아래 위치를 손잡이로 조절한다', /vertical-align:-?[\d.]+em/.test(chipHtml), chipHtml)
ok('칩이 줄바꿈으로 갈라지지 않는다', chipHtml.includes('white-space:nowrap'))
/** 색·그림자를 뺀 «치수» 부분만 — 채운 칩과 테두리 칩이 여기서 같아야 한다 */
const boxOf = (h: string) =>
  [/font-size:[\d.]+em/, /line-height:\d+/, /padding:[^;"]+/, /border-radius:[\d.]+em/, /vertical-align:-?[\d.]+em/]
    .map((re) => re.exec(h)?.[0] ?? '?')
    .join(' ')
const outline = renderToStaticMarkup(<>{styleText('돌진', [{ id: 'o', word: '돌진', style: 'outline', bg: '#223344' }])}</>)
ok('테두리 칩은 안쪽 그림자로 그린다 (상자가 안 커진다)', outline.includes('inset 0 0 0 .09em #223344'))
ok(
  '테두리 칩도 채운 칩과 같은 치수',
  boxOf(outline) === boxOf(chipHtml),
  { 테두리: boxOf(outline), 채움: boxOf(chipHtml) }
)
ok('테두리 칩은 배경을 깔지 않는다', !outline.includes('background'))
ok('정규식 특수문자가 든 낱말', renderToStaticMarkup(<>{styleText('공격+1', [{ id: 'c', word: '공격+1', style: 'chip' }])}</>).includes('>공격+1</span>'))

// ─────────────────────────────────────────── 눈금자
group('눈금자')
const rul = (mmPx: number) => renderToStaticMarkup(<Ruler axis="x" len={63} mmPx={mmPx} />)
ok('확대하면 1mm 눈금 (64개)', (rul(7.56).match(/<i /g) ?? []).length === 64)
ok('촘촘하면 5mm 로 성기게 (13개)', (rul(1.9).match(/<i /g) ?? []).length === 13)
const marked = renderToStaticMarkup(<Ruler axis="x" len={63} mmPx={4} span={{ from: 10, to: 30 }} cursor={25} />)
ok('고른 레이어 구간 표시', marked.includes('rspan') && marked.includes('left:40px') && marked.includes('width:80px'))
ok('마우스 자리 표시', marked.includes('rcursor'))

// ─────────────────────────────────────────── PNG
group('PNG 내보내기')
const card: Component = {
  id: 'c',
  name: 'c',
  size,
  background: '#FFFDFA',
  layers: [{ id: 'art', name: '그림', kind: 'image', x: 0, y: 0, w: 63, h: 53, fit: 'cover', asset: 'a1' }],
}
const one = buildSvg([{ component: card }], {
  assets: new Map([['a1', 'data:image/png;base64,AAAA']]),
  scale: 300 / 96,
  fontCss: '@font-face{font-family:"X";src:url(data:font/ttf;base64,BB);}',
})
ok('SVG 네임스페이스', one.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'))
ok('안쪽 div 도 네임스페이스', one.svg.includes('<div xmlns="http://www.w3.org/1999/xhtml"'))
ok('300dpi -> 63mm = 744px', Math.round(one.w) === 744, one.w)
const vb = /viewBox="0 0 ([\d.]+) /.exec(one.svg)!
ok('viewBox 는 96dpi 기준 (벡터로 확대)', near(Number(vb[1]), (63 * 96) / 25.4))
ok('그림이 data URL 로 들어간다', one.svg.includes('data:image/png;base64,AAAA'))
ok('blob URL 이 남지 않는다', !one.svg.includes('blob:'))
ok('글꼴이 심겼다', one.svg.includes('@font-face') && one.svg.includes('base64,BB'))
ok('CSS 변수도 넣는다', one.svg.includes('--hd-sans:'))
ok('한 장은 여백 없이 카드 크기', one.svg.includes('width:63mm;height:88mm') && !one.svg.includes('background:#fff;'))
const grid = buildSvg(Array.from({ length: 7 }, () => ({ component: card })), { assets: new Map(), cols: 4, gap: 5 })
ok('7장/4열 -> 2줄 격자', grid.svg.includes('width:277mm;height:191mm'))

// PNG 만 다르게 나오던 문제 두 가지 — 여기서 못 갈라지게 막는다
ok('글꼴 굵기 선언이 화면과 같다 (기본은 합성 허용)', faceWeight({}) === '400')
ok('합성을 끄면 모든 굵기 담당', faceWeight({ synth: false }) === '100 900')
// 칩은 화면·인쇄·PNG 가 같은 `styleText` 를 쓴다. 실제로 같은지 글자 그대로 비교한다.
const kwForPng: Keyword[] = [{ id: 'k', word: '돌진', style: 'chip', bg: '#112233' }]
const onScreen = renderToStaticMarkup(<>{styleText('돌진', kwForPng)}</>)
const inPng = buildSvg(
  [
    {
      component: {
        ...card,
        layers: [{ id: 't', name: '글자', kind: 'text', x: 0, y: 0, w: 63, h: 20, text: '돌진' }],
      },
    },
  ],
  { assets: new Map(), keywords: kwForPng }
).svg
ok('PNG 의 칩이 화면의 칩과 글자 그대로 같다', inPng.includes(onScreen), { onScreen })
// 클래스로 준 스타일은 SVG 안에 안 따라간다 — 렌더가 인라인 스타일만 쓰는 이유
ok('렌더 결과에 스타일을 기대는 class 가 없다', !/class="(?!hd-piece)/.test(inPng))
ok('여러 장은 흰 배경', grid.svg.includes('background:#fff;'))
ok('둘째 줄 y 자리', grid.svg.includes('top:98mm'))
let threw = false
try {
  buildSvg([], { assets: new Map() })
} catch {
  threw = true
}
ok('빈 목록은 막는다', threw)

// ─────────────────────────────────────────── 편집 상태
group('편집 — 덱·글꼴·키워드')
const s = () => useStore.getState()
s().addDeck('둘째', { w: 63, h: 88, shape: 'rect' })
s().addDeck('셋째', { w: 63, h: 88, shape: 'rect' })
const names = () => s().project.decks.map((d) => d.name)
s().renameProject('나의 게임')
ok('프로젝트 이름', s().project.name === '나의 게임')
const src = s().project.decks[0]!
s().selectDeck(src.id)
s().duplicateDeck(src.id)
const copy = s().project.decks.at(-1)!
ok('덱 복제 — 틀을 공유하지 않는다', copy.component !== src.component)
s().selectDeck(src.id)
s().patchSize({ w: 50 })
ok('원본을 고쳐도 사본은 그대로', s().project.components[copy.component]!.size.w === 63)
s().addFont({ id: 'f1', family: 'Pretendard', name: 'P.ttf' })
s().selectDeck(copy.id)
s().addLayer('text')
const lid = s().layerId!
s().patchLayer(lid, { font: 'Pretendard' })
const layerFont = () => (s().project.components[s().componentId()]!.layers.find((l) => l.id === lid) as any).font
s().renameFontRef('f1', '프리텐다드')
ok('글꼴 이름을 바꾸면 쓰던 글자도 따라간다', layerFont() === '프리텐다드')
s().removeFont('f1')
ok('글꼴을 지우면 기본으로 돌아간다', layerFont() === undefined)
// 덱 순서는 끌어서 바꾼다
const ordered = s().project.decks.map((d) => d.id)
s().setDeckOrder([ordered[1]!, ordered[0]!, ...ordered.slice(2)])
ok('끌어 놓은 순서대로 바뀐다', s().project.decks[0]!.id === ordered[1])
s().setDeckOrder([ordered[0]!])
ok('덱이 빠진 목록은 무시한다 (덱을 잃지 않는다)', s().project.decks.length === ordered.length)

// 보드 — 덱과 같은 프로젝트 안에 살지만 서로를 건드리면 안 된다
{
  const deckCount = s().project.decks.length
  s().addBoard('본판', { w: 297, h: 420, shape: 'rect' })
  const b = s().board()!
  ok('보드를 만들면 보드 탭으로 간다', s().mode === 'board' && s().boardId === b.id)
  ok('덱은 그대로다', s().project.decks.length === deckCount)
  ok('보드 틀이 곧 편집 대상이다', s().componentId() === b.component)
  ok('보드에는 인스턴스가 없다', s().instance() === undefined)
  ok('A4 에 안 들어가는 판은 A3 종이로 시작한다', b.sheet.w === 297 && b.sheet.h === 420)

  // 판 크기는 덱과 같은 `patchSize` 로 고친다 — 편집 경로가 하나여야 한다
  s().patchSize({ w: 400 })
  ok('판 크기를 고치면 보드 틀이 바뀐다', s().project.components[b.component]!.size.w === 400)

  s().patchBoard({ tiling: 'tile', overlap: 12 })
  ok('앉히기·겹침이 보드에 남는다', s().board()!.tiling === 'tile' && s().board()!.overlap === 12)

  // 덱 탭으로 돌아가면 편집 대상도 덱으로 돌아가야 한다 (둘이 안 섞인다)
  const boardComp = b.component
  s().setMode('deck')
  ok('덱 탭으로 돌아오면 덱 틀을 본다', s().componentId() !== boardComp)

  s().duplicateBoard(b.id)
  const dup = s().board()!
  ok('보드 복제 — 틀을 공유하지 않는다', dup.component !== boardComp)
  s().removeBoard(dup.id)
  ok('사본을 지우면 그 틀도 같이 사라진다', s().project.components[dup.component] === undefined)
  ok('원본 보드는 남는다', (s().project.boards ?? []).some((x) => x.id === b.id))

  // **마지막 보드도 지울 수 있다** — 덱과 다른 점이다. 없어도 되는 구성품이라서.
  s().removeBoard(b.id)
  ok('보드는 하나 남았어도 지워진다', (s().project.boards ?? []).length === 0)
  ok('보드를 다 지워도 덱은 멀쩡하다', s().project.decks.length === deckCount)
  s().setMode('deck')
}

// 덱 JSON — 다른 프로젝트에서 구조 가져오기
const packDeck = s().project.decks[0]!
const pack = deckToJson(s().project, packDeck)
ok('꾸러미 표시', pack.handeck === 1 && pack.kind === 'deck')
ok('검사 통과', checkDeckJson(pack).ok)
ok('남의 JSON 은 막는다', !checkDeckJson({ hello: 1 }).ok)
ok('프로젝트 파일도 막는다 (kind 가 다르다)', !checkDeckJson({ handeck: 1, decks: [] }).ok)
const tgt = s().project.decks[1]!
const tgtCompId = tgt.component
s().applyDeckJson(tgt.id, pack, false)
const applied = s().project.decks.find((x) => x.id === tgt.id)!
ok('덱·틀 id 는 그대로 (묶음이 안 깨진다)', applied.id === tgt.id && applied.component === tgtCompId)
ok('레이어 구조가 옮겨왔다', s().project.components[applied.component]!.layers.length === pack.front.layers.length)
ok('카드는 안 가져왔다', applied.instances.length === tgt.instances.length)

// 레이어 복제 — 원본 «앞» 에 놓이고, 카드별 값도 따라가야 한다
s().selectDeck(s().project.decks[0]!.id)
const compId = s().componentId()
const layersOf = () => s().project.components[compId]!.layers
s().addLayer('text')
const srcId = s().layerId!
s().patchLayer(srcId, { override: 'text', name: '제목' })
const instId = s().deck().instances[0]!.id
s().setValue(instId, srcId, '원본 글자')
const beforeCount = layersOf().length
s().duplicateLayer(srcId)
const copyId = s().layerId!
ok('사본이 하나 늘었다', layersOf().length === beforeCount + 1)
ok('사본이 골라진다', copyId !== srcId)
ok('사본은 원본 바로 앞에 온다', layersOf().findIndex((l) => l.id === copyId) === layersOf().findIndex((l) => l.id === srcId) + 1)
const dup = layersOf().find((l) => l.id === copyId)! as any
const orig = layersOf().find((l) => l.id === srcId)! as any
ok('이름에 사본', dup.name === '제목 사본')
ok('살짝 밀려 있다 (겹치면 복제됐는지 모른다)', dup.x === orig.x + 2 && dup.y === orig.y + 2)
ok('속성은 그대로', dup.kind === orig.kind && dup.override === orig.override)
ok('카드별 값도 따라온다', s().deck().instances.find((i) => i.id === instId)!.values[copyId] === '원본 글자')
s().patchLayer(copyId, { name: '부제' })
ok('사본을 고쳐도 원본은 그대로', layersOf().find((l) => l.id === srcId)!.name === '제목')
s().undo()
s().undo()
ok('되돌리면 사본이 사라진다', layersOf().length === beforeCount)

s().addKeyword()
ok('키워드 추가', (s().project.keywords ?? []).length === 1)
s().patchKeyword(s().project.keywords![0]!.id, { word: '돌진' })
ok('키워드 편집', s().project.keywords![0]!.word === '돌진')
s().removeKeyword(s().project.keywords![0]!.id)
ok('키워드 삭제', (s().project.keywords ?? []).length === 0)
s().undo()
ok('되돌리기', (s().project.keywords ?? []).length === 1)

// ─────────────────────────────────────────── 묶음 (.handeck)
group('묶음 — 그림·글꼴까지 한 파일로')
const enc = new TextEncoder()
const bytes = (s: string) => enc.encode(s) as Uint8Array<ArrayBuffer>
ok('crc32 이 규격값과 맞는다', crc32(bytes('123456789')) === 0xcbf43926)
ok('빈 내용의 crc32 은 0', crc32(bytes('')) === 0)

const entries = [
  { name: 'project.json', data: bytes('{"handeck":1}') },
  { name: '그림/한글 이름.png', data: bytes('PNG-DATA') },
]
const zipped = zipBytes(entries)
const dec2 = new TextDecoder()
const back = unzip(zipped.buffer)
ok('넣은 대로 나온다', dec2.decode(back.get('project.json')!) === '{"handeck":1}')
ok('한글 이름도 살아남는다', back.has('그림/한글 이름.png'))
ok('내용도 그대로', dec2.decode(back.get('그림/한글 이름.png')!) === 'PNG-DATA')
ok('zip 으로 알아본다', looksLikeZip(zipped.buffer))
ok('json 은 zip 이 아니다', !looksLikeZip(bytes('{"handeck":1}').buffer))
ok('같은 내용은 같은 파일 (시각을 안 넣는다)', String(zipBytes(entries)) === String(zipped))
// 내용이 한 바이트만 달라도 걸린다 (첫 항목의 데이터는 헤더 30 + 이름 12 바이트 뒤)
const broken = zipped.slice()
const dataAt = 30 + 'project.json'.length + 2
broken[dataAt] = broken[dataAt]! ^ 0xff
let caught = false
try {
  unzip(broken.buffer)
} catch {
  caught = true
}
ok('깨진 파일은 거절한다', caught)

const bundleProject: Project = {
  handeck: 1,
  name: '나의 게임',
  components: {
    c1: {
      id: 'c1',
      name: 'c',
      size,
      background: '#fff',
      layers: [
        { id: 'art', name: '그림', kind: 'image', x: 0, y: 0, w: 63, h: 88, asset: 'aa11' },
        { id: 't', name: '글자', kind: 'text', x: 0, y: 0, w: 63, h: 10, text: '제목', font: '내글꼴' },
      ],
    },
  },
  decks: [{ id: 'd', name: 'd', component: 'c1', sheet: A4, duplex: false, instances: [{ id: 'i', qty: 1, values: {} }] }],
  fonts: [{ id: 'ff22', family: '내글꼴', name: 'My.ttf' }],
}
const built = buildBundleBytes({
  project: bundleProject,
  assets: [{ id: 'aa11', name: '표지.png', type: 'image/png', size: 8, data: bytes('PNG-DATA') }],
  fonts: [{ id: 'ff22', family: '내글꼴', name: 'My.ttf', type: 'font/ttf', size: 4, data: bytes('TTF!') }],
})
const files = unzip(built.buffer)
ok('project.json 만 빼서 써도 된다', JSON.parse(dec2.decode(files.get('project.json')!)).handeck === 1)
ok('파일 이름이 곧 id', files.has('assets/aa11.png') && files.has('fonts/ff22.ttf'))

const parsed = parseBundle(built.buffer)
ok('프로젝트가 그대로 들어 있다', parsed.project.name === '나의 게임')
ok('그림이 id 로 짝지어진다', parsed.assets[0]!.id === 'aa11')
ok('원래 파일 이름은 목록에서 되찾는다', parsed.assets[0]!.name === '표지.png')
ok('그림 내용', dec2.decode(parsed.assets[0]!.data) === 'PNG-DATA')
ok('글꼴 이름(family)이 살아남는다', parsed.fonts[0]!.family === '내글꼴')
ok('목록이 들어 있다', parsed.manifest?.bundle === 1)
ok('경고 없음', parsed.warnings.length === 0, parsed.warnings)

// 목록에는 있는데 파일이 없는 묶음 — 잘렸거나 손으로 지운 것
const short = zipBytes([
  { name: 'project.json', data: bytes(JSON.stringify(bundleProject)) },
  { name: 'bundle.json', data: bytes(JSON.stringify(parsed.manifest)) },
])
ok('빠진 그림을 이름으로 짚어준다', parseBundle(short.buffer).warnings.some((w) => w.includes('표지.png')))
ok('빠진 글꼴도 짚어준다', parseBundle(short.buffer).warnings.some((w) => w.includes('My.ttf')))

// ─────────────────────────────────────────── 예제 프로젝트
group('예제 프로젝트 (example/project.json)')
// `npm run check` 는 늘 프로젝트 뿌리에서 돈다
const ex = JSON.parse(readFileSync('example/project.json', 'utf8')) as Project
ok('handeck 프로젝트다', ex.handeck === 1)
ok('덱이 여럿 있다', ex.decks.length >= 10, ex.decks.length)

for (const d of ex.decks) {
  const front = ex.components[d.component]
  ok(`«${d.name}» 앞면 틀이 있다`, !!front)
  if (!front) continue

  // 뒷면은 앞면과 규격이 같아야 앞뒤가 맞물린다
  if (d.back) {
    const back = ex.components[d.back]
    ok(`«${d.name}» 뒷면 틀이 있다`, !!back)
    if (back) ok(`«${d.name}» 앞뒤 규격이 같다`, back.size.w === front.size.w && back.size.h === front.size.h)
  }

  // 인스턴스가 채우는 값은 «카드마다 다르게» 가 켜진 레이어만 가리켜야 한다
  const overridable = new Set(front.layers.filter((l) => l.override).map((l) => l.id))
  const strays = new Set<string>()
  for (const i of d.instances) for (const k of Object.keys(i.values)) if (!overridable.has(k)) strays.add(k)
  ok(`«${d.name}» 값이 전부 오버라이드 레이어를 가리킨다`, strays.size === 0, [...strays])

  // 적어둔 기대 장수와 실제가 맞는가 (문서의 장수를 옮겨적었으니 여기서 걸린다)
  if (d.expect !== undefined) ok(`«${d.name}» 장수 = ${d.expect}`, totalPieces(d) === d.expect, totalPieces(d))

  // 종이에 깔리기는 하는가
  const g2 = layout(front.size, d.sheet)
  ok(`«${d.name}» A4 에 깔린다`, g2.cols > 0 && g2.rows > 0)
}

// ── 묶어 인쇄 ──────────────────────────────────────────────
const deckByName = (n: string) => ex.decks.find((d) => d.name === n)!
const heart = deckByName('두근! 토큰')
const villain = deckByName('빌런 토큰')
ok('두근!·빌런은 규격이 같다 (묶을 수 있다)', sameSize(ex, heart, villain))
ok('토큰은 지름만 한 네모다', ex.components[heart.component]!.size.w === 25 && ex.components[heart.component]!.size.h === 25)
const apart = imposeDecks(ex, [heart]).pages.length + imposeDecks(ex, [villain]).pages.length
const together = imposeDecks(ex, [heart, villain]).pages.length
ok('따로 뽑으면 종이가 더 든다', together < apart, { apart, together })
const merged = imposeDecks(ex, [heart, villain])
ok('묶어도 장수는 그대로', merged.pages.filter((p) => p.side === 'front').reduce((n, p) => n + p.cells.length, 0) === 60)
const kinds = new Set(merged.pages[0]!.cells.map((c) => c.front.id))
ok('한 장 안에 두 덱의 틀이 섞인다', kinds.size === 2, [...kinds])
ok('묶음이 둘이다 (카드 · 토큰)', (ex.printGroups ?? []).length === 2)
ok('묶음마다 색이 다르다', new Set((ex.printGroups ?? []).map((g, i) => groupColor(g, i))).size === 2)
// 규격이 다른 덱이 한 묶음에 섞이면 한 격자에 못 깐다 — 절대 생기면 안 되는 상태.
// 없는 덱을 가리키는 것도 마찬가지다 (덱을 지웠는데 묶음에 남으면 조용히 빠진다)
for (const g of ex.printGroups ?? []) {
  const ds = g.decks.map((id) => ex.decks.find((d) => d.id === id)!)
  ok(`«${g.name}» 이 가리키는 덱이 전부 있다`, ds.every(Boolean), g.decks)
  ok(`«${g.name}» 은 규격이 다 같다`, ds.every((d) => sameSize(ex, ds[0]!, d)))
  const apartN = ds.reduce((n, d) => n + imposeDecks(ex, [d]).pages.length, 0)
  ok(`«${g.name}» 을 묶으면 종이가 준다`, imposeDecks(ex, ds).pages.length < apartN)
}
ok(
  '63×88 덱은 전부 묶였다',
  ex.decks.every((d) => {
    const c = ex.components[d.component]!
    return c.size.w !== 63 || c.size.h !== 88 || !!printSet(ex, d.id).find((x) => x.id !== d.id)
  })
)
ok('묶인 덱을 인쇄하면 묶음 전체가 나온다 (토큰 3덱)', printSet(ex, heart.id).length === 3)
// 뒷면이 덱마다 달라도 칸이 자기 것을 들고 간다
const mixed = imposeDecks(ex, [deckByName('운명 카드-초'), deckByName('재앙')])
const backIds = new Set(mixed.pages[0]!.cells.map((c) => c.back?.id))
ok('칸마다 자기 뒷면을 들고 간다', backIds.size >= 1 && [...backIds].every(Boolean))

// tokens.md 가 정한 장수 — 여기가 이 예제의 «정답지» 다
const qtyOf = (name: string) => totalPieces(deckByName(name))
ok('능력 100장 (tokens.md §2)', qtyOf('능력 카드') === 100, qtyOf('능력 카드'))
ok('단서 27장 (§3.1)', qtyOf('물건 · 단서') === 27, qtyOf('물건 · 단서'))
ok('유물 13장 = 진실 10 + 엘릭서 3 (§3.2)', qtyOf('물건 · 유물') === 13, qtyOf('물건 · 유물'))
ok('금화 60장 (§12)', qtyOf('금화') === 60)
// 운명 카드는 구간별로 덱이 나뉘어 있다. 합이 48이어야 막당 2장씩 24막에 맞는다
const fate = ['운명 카드-초', '운명 카드-중', '운명 카드-후']
ok('운명 48장 = 세 구간 × 16 (§5)', fate.reduce((n, x) => n + qtyOf(x), 0) === 48, fate.map(qtyOf))
ok('구간마다 16장씩', fate.every((x) => qtyOf(x) === 16), fate.map(qtyOf))
ok('재앙 10장 (§4)', qtyOf('재앙') === 10)
ok('성향 20장 (§7)', qtyOf('남주성향') === 20)
ok('해골(사기) 40장 (§8)', qtyOf('해골 카드') === 40)
ok('조우 36개 = 9종 × 4 (§11)', qtyOf('조우 토큰') === 36)
ok('플레이어 캐릭터 8장 (§1)', qtyOf('캐릭터-플레이어') === 8)

// 재앙 뒷면은 운명 뒷면과 **똑같아야** 한다 (섞였을 때 구분되면 안 된다)
const backOf = (name: string) => {
  const d = deckByName(name)
  return d.back ? ex.components[d.back]! : null
}
const bare = (c: Component | null) => JSON.stringify({ ...c, id: '', name: '' })
const fateBack = backOf('운명 카드-초')
const omenBack = backOf('재앙')
ok('운명·재앙 둘 다 뒷면이 있다', !!fateBack && !!omenBack)
ok('재앙 뒷면이 운명 뒷면과 똑같다 (§4 — 섞이면 구분되면 안 된다)', bare(fateBack) === bare(omenBack))
// 구간이 나뉘어도 뒷면은 하나여야 한다 — 초·중·후가 구분되면 다음 카드가 예측된다
for (const x of fate.slice(1)) ok(`«${x}» 뒷면도 운명 뒷면과 같다`, bare(backOf(x)) === bare(fateBack))

// ─────────────────────────────────────────── 마크다운
group('마크다운 — 룰북 본문')

// 그리는 데까지 가봐야 안다 — 파서는 멀쩡한데 렌더에서 터지는 일이 흔하다
const mdPage: Component = {
  id: 'mc',
  name: '쪽',
  size: { w: 148, h: 210, shape: 'rect' },
  background: '#FFFDFA',
  layers: [
    {
      id: 'body',
      name: '본문',
      kind: 'md',
      x: 14,
      y: 30,
      w: 120,
      h: 160,
      columns: 2,
      size: 8.6,
      override: 'text',
    },
  ],
}
const mdHtml = renderToStaticMarkup(
  <Piece
    component={mdPage}
    instance={{ id: 'p1', qty: 1, values: { body: '## 소제목\n\n**두근!** 을 잃는다\n\n| 가 | 나 |\n| --- | --- |\n| 1 | 2 |' } }}
    opts={{ assetUrl: () => undefined, keywords: [{ id: 'k', word: '두근!', style: 'chip' }] }}
  />
)
ok('소제목이 그려진다', mdHtml.includes('소제목'))
ok('표가 <table> 로 나온다', mdHtml.includes('<table'))
ok('두 단으로 흐른다', mdHtml.includes('column-count:2'), mdHtml.slice(0, 200))
// 본문 안에서도 키워드 칠이 먹어야 한다 — 카드와 룰북이 같은 낱말을 쓴다
ok('키워드가 본문 안에서도 칠해진다', mdHtml.includes('border-radius') && mdHtml.includes('두근!'))
ok('넘쳐도 스크롤이 아니라 잘린다', mdHtml.includes('overflow:hidden'))

const md = parseMarkdown(
  '# 제목\n\n첫 문단\n둘째 줄\n\n- 하나\n- 둘\n  - 안쪽\n\n| a | b |\n| --- | ---: |\n| 1 | 2 |\n\n> 인용\n\n---\n'
)
ok('블록 종류를 순서대로 가른다', md.map((b) => b.kind).join(',') === 'h,p,list,table,quote,hr', md.map((b) => b.kind))
ok('헤딩 단계를 읽는다', md[0]!.kind === 'h' && (md[0] as { level: number }).level === 1)
ok('한 문단 안의 줄바꿈은 살린다', (md[1] as { text: string }).text.includes('\n'))
const mdList = md[2] as { items: { text: string; depth: number }[] }
ok('목록 세 항목', mdList.items.length === 3, mdList.items.length)
ok('들여쓴 항목은 깊이가 있다', mdList.items[2]!.depth === 1, mdList.items[2]!.depth)
const mdTable = md[3] as { head: string[]; align: string[]; rows: string[][] }
ok('표 머리와 본문을 가른다', mdTable.head.length === 2 && mdTable.rows.length === 1)
ok('오른쪽 정렬을 읽는다', mdTable.align[1] === 'right', mdTable.align)
// 구분선이 없으면 그냥 «|» 가 든 문장이다 — 표로 잘못 읽으면 문장이 사라진다
ok('구분선 없는 |는 표가 아니다', parseMarkdown('a | b\nc | d')[0]!.kind === 'p')
const runs = parseInline('평범 **굵게** 그리고 `코드`')
ok('굵게·코드를 가른다', runs.some((r) => r.bold) && runs.some((r) => r.code), runs)
ok('굵게 안의 글자가 남는다', runs.find((r) => r.bold)?.text === '굵게')
ok('별표가 없으면 한 덩어리', parseInline('그냥 글').length === 1)

// ─────────────────────────────────────────── 룰북
group('룰북 — 원고에서 쪽으로')
const bookSrc = readFileSync('example/rulebook.md', 'utf8')
const doc = parseRulebookSource(bookSrc)
ok('예제 원고가 여러 쪽으로 나뉜다', doc.pages.length >= 10, doc.pages.length)
ok('쪽수가 4의 배수다 (중철)', doc.pages.length % 4 === 0, doc.pages.length)
ok('첫 쪽 제목이 곧 룰북 이름', doc.title === doc.pages[0]!.title && !!doc.title, doc.title)
ok('경고가 없다', doc.warnings.length === 0, doc.warnings)
ok('제목은 본문에서 빠진다', !doc.pages[1]!.body.startsWith('#'), doc.pages[1]!.body.slice(0, 20))
// 주석이 새면 «원고에 남긴 메모» 가 그대로 인쇄된다
ok('HTML 주석이 걷힌다', !doc.pages.some((p) => p.body.includes('<!--') || p.body.includes('원고 가져오기')))
// 표의 구분선(`| --- |`)을 쪽 나눔으로 읽으면 표가 두 쪽으로 찢어진다
ok('표가 쪽 나눔에 안 찢긴다', doc.pages.some((p) => p.body.includes('| --- |') && p.body.includes('| 능력 카드')))

const j = parseRulebookSource('{"title":"J","pages":[{"title":"가","body":"본문"},"## 나\\n둘째"]}')
ok('JSON 원고도 읽는다', j.title === 'J' && j.pages.length === 2, j.pages)
ok('JSON 안의 마크다운 문자열도 제목을 뽑는다', j.pages[1]!.title === '나')
ok('못 읽는 JSON 은 이유를 말한다', parseRulebookSource('{ 망가짐').warnings.length > 0)
ok('## 마다 나누기도 된다', parseRulebookSource('# 표지\n\n글\n\n## 가\n\n글\n\n## 나\n\n글', 'h2').pages.length === 3)

const madeBook = buildRulebook(doc, {
  size: { w: 148, h: 210, shape: 'rect' },
  sheet: { w: 297, h: 210, margin: 0, gap: 0, marks: 'none' },
  binding: 'saddle',
})
ok('쪽마다 인스턴스가 하나씩', madeBook.rulebook.pages.length === doc.pages.length)
ok('쪽 수량은 늘 1', madeBook.rulebook.pages.every((p) => p.qty === 1))
ok('본문 레이어가 마크다운이다', madeBook.component.layers.some((l) => l.id === BODY_LAYER && l.kind === 'md'))
ok(
  '제목·본문·쪽번호가 쪽마다 다르다',
  [TITLE_LAYER, BODY_LAYER, FOLIO_LAYER].every((id) => madeBook.component.layers.find((l) => l.id === id)?.override === 'text')
)
ok('표지에는 쪽번호가 없다', madeBook.rulebook.pages[0]!.values[FOLIO_LAYER] === '')
ok('둘째 쪽은 2번', madeBook.rulebook.pages[1]!.values[FOLIO_LAYER] === '2')
ok(
  '레이어가 쪽 안에 들어간다',
  madeBook.component.layers.every((l) => l.x >= 0 && l.y >= 0 && l.x + l.w <= 148.01 && l.y + l.h <= 210.01)
)

// 넘침 — 화면에서는 «안 보일» 뿐이라 여기서 잡아야 한다
const long = {
  ...madeBook.rulebook.pages[0]!,
  values: { ...madeBook.rulebook.pages[0]!.values, [BODY_LAYER]: '가나다라마바사'.repeat(400) },
}
ok('넘치는 쪽을 짚어낸다', bodyFit(madeBook.component, long)!.over)
ok(
  '예제 원고는 넘치는 쪽이 없다',
  madeBook.rulebook.pages.every((p) => !bodyFit(madeBook.component, p)!.over),
  madeBook.rulebook.pages.map((p, i) => (bodyFit(madeBook.component, p)!.over ? i + 1 : 0)).filter(Boolean)
)

// ─────────────────────────────────────────── 중철 조판
group('중철 — 접었을 때 순서가 맞는가')
const A5: PieceSize = { w: 148, h: 210, shape: 'rect' }
const LAND: SheetSpec = { w: 297, h: 210, margin: 0, gap: 0, marks: 'none' }
const pagesOf = (n: number, p = 'p') => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, qty: 1, values: {} }))
const saddle = planBook(A5, LAND, { binding: 'saddle', duplex: 'short', pages: pagesOf(8) })
ok('8쪽 = 종이 2장 = 4면', saddle.sheets.length === 4, saddle.sheets.length)
ok('바깥 장은 8·1 을 문다', saddle.sheets[0]!.slots.map((s) => s.page).join(',') === '8,1', saddle.sheets[0]!.slots)
ok('그 뒷면은 2·7', saddle.sheets[1]!.slots.map((s) => s.page).join(',') === '2,7', saddle.sheets[1]!.slots)
ok(
  '안쪽 장은 6·3 / 4·5',
  saddle.sheets[2]!.slots.map((s) => s.page).join(',') === '6,3' &&
    saddle.sheets[3]!.slots.map((s) => s.page).join(',') === '4,5'
)
// 접었을 때 1..8 이 한 번씩 나와야 한다 — 이 계산의 전부가 이것이다
const seen = saddle.sheets
  .flatMap((s) => s.slots.map((x) => x.page))
  .filter((n): n is number => !!n)
  .sort((a, b) => a - b)
ok('쪽이 빠지거나 겹치지 않는다', seen.join(',') === '1,2,3,4,5,6,7,8', seen)
ok('두 쪽이 나란히 눕는다', saddle.sheets[0]!.slots[1]!.x - saddle.sheets[0]!.slots[0]!.x === 148)
ok('가운데에서 접는다', saddle.foldX === 148.5, saddle.foldX)
// 16쪽에서도 성립해야 한다 — 사람이 손으로 만들면 여기서부터 틀린다
const big = planBook(A5, LAND, { binding: 'saddle', duplex: 'short', pages: pagesOf(16, 'b') })
const bigSeen = big.sheets
  .flatMap((s) => s.slots.map((x) => x.page))
  .filter((n): n is number => !!n)
  .sort((a, b) => a - b)
ok('16쪽도 한 번씩', bigSeen.join(',') === Array.from({ length: 16 }, (_, i) => i + 1).join(','), bigSeen)
ok('16쪽 = 종이 4장', big.sheets.length === 8)

// 4의 배수가 아니면 백지로 채운다. 안 채우면 접었을 때 쪽이 어긋난다
const pad = planBook(A5, LAND, { binding: 'saddle', duplex: 'short', pages: pagesOf(5, 'q') })
ok('5쪽은 8쪽으로 채워진다', pad.padded === 8 && pad.count === 5, { padded: pad.padded })
ok('없는 쪽 자리는 백지', pad.sheets[0]!.slots[0]!.page === null)

const staple = planBook(A5, { ...LAND, w: 148, h: 210 }, { binding: 'staple', duplex: 'long', pages: pagesOf(3, 'r') })
ok('모서리 스테이플은 한 면에 한 쪽', staple.sheets.every((s) => s.slots.length === 1))
ok(
  '차례대로 나온다 (마지막은 백지)',
  staple.sheets.map((s) => s.slots[0]!.page).join(',') === '1,2,3,',
  staple.sheets.map((s) => s.slots[0]!.page)
)
ok('단면이면 뒷면이 없다', planBook(A5, LAND, { binding: 'staple', duplex: false, pages: pagesOf(1, 's') }).sheets.length === 1)
// A5 두 쪽은 A4 «세로» 에 안 들어간다 — 조용히 잘리면 안 되니 미리 말해야 한다
ok('종이가 좁으면 넘침으로 잡는다', planBook(A5, { ...LAND, w: 210, h: 297 }, { binding: 'saddle', duplex: 'short', pages: pagesOf(4, 't') }).overflow)
ok('맞는 종이를 짚어준다', suggestSheet(A5, 'saddle', SHEET_PRESETS)?.w === 297)
// 한 쪽만 앉히면 폭이 절반이면 된다 — 가장 작은 종이가 A4 가 아니라 Letter 일 수도 있다.
// 이름이 아니라 «들어가는가» 로 본다 (목록에 종이를 더해도 안 깨지게)
const stapleSheet = suggestSheet(A5, 'staple', SHEET_PRESETS)!
ok('한 쪽만 앉히면 더 작은 종이로 충분', stapleSheet.w >= 148 && stapleSheet.h >= 210 && stapleSheet.w < 297, stapleSheet)

// 예제 프로젝트의 룰북도 같은 잣대로 본다
const exBook = (ex.rulebooks ?? [])[0]
ok('예제에 룰북이 있다', !!exBook)
if (exBook) {
  const bc = ex.components[exBook.component]!
  ok('룰북 틀이 있다', !!bc)
  ok('쪽이 4의 배수다', exBook.pages.length % 4 === 0, exBook.pages.length)
  const bp = planBook(bc.size, exBook.sheet, exBook)
  ok('종이에 들어간다', !bp.overflow)
  ok('백지가 없다', bp.padded === bp.count, { padded: bp.padded, count: bp.count })
  ok(
    '넘치는 쪽이 없다',
    exBook.pages.every((p) => !bodyFit(bc, p)!.over),
    exBook.pages.map((p, i) => (bodyFit(bc, p)!.over ? i + 1 : 0)).filter(Boolean)
  )
  const values = new Set(exBook.pages.flatMap((p) => Object.keys(p.values)))
  const overridable = new Set(bc.layers.filter((l) => l.override).map((l) => l.id))
  ok('쪽 값이 전부 오버라이드 레이어를 가리킨다', [...values].every((v) => overridable.has(v)), [...values])
}

console.log(`\n${pass}개 통과${fail ? `, ${fail}개 실패` : ''}`)
process.exit(fail ? 1 : 0)
