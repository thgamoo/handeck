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

import { renderToStaticMarkup } from 'react-dom/server'
import { colorAlpha, gradientAlpha, hitLayer, pickLayer } from '../src/core/hit.ts'
import { impose, layout } from '../src/core/impose.ts'
import { expandForBleed, fontStack, gradientCss, styleText } from '../src/core/render.tsx'
import { buildSvg } from '../src/core/png.ts'
import { Ruler } from '../src/ui/Ruler.tsx'
import { useStore } from '../src/store/project.ts'
import { A4, BLEED_ENABLED, type Component, type Keyword, type Layer, type Project, type SheetSpec } from '../src/core/model.ts'

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
const last = s().project.decks[2]!.id
s().moveDeck(last, -1)
ok('덱 순서 위로', names()[1] === '셋째', names())
s().moveDeck(last, 1)
ok('덱 순서 아래로', names()[2] === '셋째')
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
s().addKeyword()
ok('키워드 추가', (s().project.keywords ?? []).length === 1)
s().patchKeyword(s().project.keywords![0]!.id, { word: '돌진' })
ok('키워드 편집', s().project.keywords![0]!.word === '돌진')
s().removeKeyword(s().project.keywords![0]!.id)
ok('키워드 삭제', (s().project.keywords ?? []).length === 0)
s().undo()
ok('되돌리기', (s().project.keywords ?? []).length === 1)

console.log(`\n${pass}개 통과${fail ? `, ${fail}개 실패` : ''}`)
process.exit(fail ? 1 : 0)
