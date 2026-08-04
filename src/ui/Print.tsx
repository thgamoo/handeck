/**
 * 인쇄 화면 — 종이 그대로를 DOM 으로 그린다.
 *
 * 브라우저의 인쇄 대화상자를 그대로 쓴다. 라이브러리도 서버도 없다.
 * 사용자는 «대상: PDF로 저장» 을 고르면 그게 결과물이고,
 * 프린터를 고르면 바로 인쇄된다. 글자는 벡터로 남는다.
 *
 * 정확도에 대해 (`docs/print-findings.md` 실측):
 *   페이지 상자를 63mm 처럼 작게 잡으면 Chromium 이 1/300 인치로 반올림해
 *   0.18mm 까지 틀어진다. 그래서 **페이지는 A4 로 고정**하고 조각을 그 안에
 *   mm 좌표로 깐다. 이러면 내용 위치 오차가 ±0.13mm 이고 누적되지 않는다.
 */

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { imposeDecks, type Plan } from '../core/impose.ts'
import { edgesKey, expandForBleed, Piece, type Edges } from '../core/render.tsx'
import { BLEED_ENABLED, groupOf, printSet, type Component, type Keyword, type Project } from '../core/model.ts'
import { assetUrl } from '../store/assets.ts'
import { useStore } from '../store/project.ts'
import { Printer } from './icons.tsx'

const mm = (v: number): string => `${v}mm`

/**
 * 종이 크기를 `@page` 에 넣는다.
 *
 * `@page` 는 CSS 변수를 못 받는다. 스타일 태그를 직접 만들어 붙이는 수밖에 없다.
 * 여백 0 으로 두고 우리가 종이 안에서 직접 배치한다 — 브라우저 기본 여백에
 * 맡기면 브라우저·프린터마다 달라진다.
 */
function usePageSize(w: number, h: number) {
  useEffect(() => {
    const el = document.createElement('style')
    el.textContent = `@page { size: ${w}mm ${h}mm; margin: 0; }`
    document.head.appendChild(el)
    return () => {
      el.remove()
    }
  }, [w, h])
}

/** 재단 표시 — 종이 가장자리 쪽에만 짧게. 조각 위를 지나가면 안 된다. */
function CutMarks({ plan }: { plan: Plan }) {
  if (plan.sheet.marks !== 'crop') return null
  const L = 4 // mm, 표시 길이
  const m = Math.min(plan.sheet.margin, L)
  return (
    <>
      {plan.cutsX.map((x, i) => (
        <div key={`x${i}`}>
          <div className="cut v" style={{ left: mm(x), top: 0, height: mm(m) }} />
          <div className="cut v" style={{ left: mm(x), bottom: 0, height: mm(m) }} />
        </div>
      ))}
      {plan.cutsY.map((y, i) => (
        <div key={`y${i}`}>
          <div className="cut h" style={{ top: mm(y), left: 0, width: mm(m) }} />
          <div className="cut h" style={{ top: mm(y), right: 0, width: mm(m) }} />
        </div>
      ))}
    </>
  )
}

function Sheet({
  plan,
  page,
  keywords,
}: {
  plan: Plan
  page: Plan['pages'][number]
  keywords?: Keyword[]
}) {
  /**
   * 도련은 조각마다 «어느 변에 붙는지» 가 다르다 (덩어리 안쪽 이음매엔 안 붙는다).
   * 그래서 **틀 × 변 조합**마다 한 번씩만 만들어 돌려 쓴다.
   *
   * 틀까지 열쇠에 넣는 이유: 묶어 인쇄하면 한 장 안에 여러 덱의 틀이 섞인다.
   */
  const variants = new Map<string, Component>()
  const pieceFor = (c: Component, edges: Edges): Component => {
    const k = `${c.id}:${edgesKey(edges)}`
    let v = variants.get(k)
    if (!v) {
      v = expandForBleed(c, plan.bleed, edges)
      variants.set(k, v)
    }
    return v
  }

  return (
    <div className="psheet" style={{ width: mm(plan.sheet.w), height: mm(plan.sheet.h) }}>
      {page.cells.map((cell, i) => {
        // 뒷면 장에서 뒷면 틀이 없는 칸은 비워 둔다 — 앞면을 또 찍으면 안 된다
        const c = page.side === 'back' ? cell.back : cell.front
        if (!c) return null
        return (
          // 조각의 좌표는 **재단** 기준이다. 도련이 붙은 변만큼 밖으로 밀어 그린다.
          <div
            key={i}
            className="pcell"
            style={{
              left: mm(cell.x - (cell.edges.left ? plan.bleed : 0)),
              top: mm(cell.y - (cell.edges.top ? plan.bleed : 0)),
            }}
          >
            <Piece component={pieceFor(c, cell.edges)} instance={cell.instance} opts={{ assetUrl, keywords }} />
          </div>
        )
      })}
      <CutMarks plan={plan} />
      <div className="pfoot">
        {page.no}쪽 {page.side === 'back' ? '뒷면' : '앞면'} · {plan.piece.w}×{plan.piece.h}mm ·{' '}
        {plan.cols}×{plan.rows}
      </div>
    </div>
  )
}

/**
 * 화면에서 종이를 미리 보여준다. 인쇄할 때는 이것만 남고 나머지는 숨는다.
 * 미리보기와 인쇄 결과가 같은 DOM 이라 «뽑아봐야 아는» 상황이 없다.
 */
export function PrintView({
  project,
  deckId,
  onClose,
}: {
  project: Project
  deckId: string
  onClose: () => void
}) {
  const patchSheet = useStore((st) => st.patchSheet)
  const deck = project.decks.find((d) => d.id === deckId)!
  // 묶여 있으면 묶음 전체를 한 종이에 이어 깐다 (없으면 이 덱 하나)
  const set = printSet(project, deckId)
  const group = groupOf(project, deckId)
  const plan = imposeDecks(project, set)
  usePageSize(plan.sheet.w, plan.sheet.h)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const sheets = plan.pages.length
  const pieces = plan.pages.filter((p) => p.side === 'front').reduce((n, p) => n + p.cells.length, 0)

  // body 바로 밑에 붙인다. 앱 안에 두면 인쇄할 때 `.app { display:none }` 에
  // 같이 숨어버려 빈 종이가 나온다 (실제로 그렇게 나왔다).
  return createPortal(
    <div className="printwrap">
      <div className="pbar">
        <b>인쇄 미리보기</b>
        <span>
          {group ? `${group.name} (${set.length}덱)` : deck.name} · {pieces}장 → 종이 {sheets}쪽
        </span>
        {/* 여기서는 묶음 색을 안 쓴다 — 막대가 어두워서 진한 색이 묻힌다.
            어차피 이 화면은 한 묶음만 보여주므로 색으로 구분할 일이 없다. */}
        {group && (
          <span className="pgroup" title={set.map((d) => d.name).join(' · ')}>
            <Printer size={12} /> {set.map((d) => d.name).join(' · ')}
          </span>
        )}
        <span className="sp" />
        {/* 도련은 **여기서** 정한다. 카드에는 도련이 없다 —
            자를 때 밀리는 것에 대한 대비라서 인쇄물의 속성이다.
            지금은 기능이 꺼져 있어 «맞붙이기» 하나뿐이다 (`BLEED_ENABLED`). */}
        {BLEED_ENABLED && (
          <label className="pbleed">
            도련
            <select
              value={plan.bleedMode}
              onChange={(e) => patchSheet({ bleedMode: e.target.value as 'none' | 'outer' | 'each' })}
            >
              <option value="none">없음 — 맞붙이기</option>
              <option value="outer">바깥 테두리만</option>
              <option value="each">조각마다 — 인쇄소용</option>
            </select>
            {plan.bleedMode !== 'none' && (
              <input
                type="number"
                min={0}
                step={0.5}
                value={plan.sheet.bleed ?? 3}
                onChange={(e) => patchSheet({ bleed: Math.max(0, Number(e.target.value) || 0) })}
              />
            )}
          </label>
        )}
        {/* 글꼴이 다 붙기 전에 인쇄하면 첫 장이 대체 글꼴로 나간다.
            불러온 글꼴은 이미 로드해서 등록하지만, 여기서 한 번 더 확인하고 넘어간다. */}
        <button
          className="go"
          onClick={() => {
            void document.fonts.ready.then(() => window.print())
          }}
        >
          인쇄 / PDF 저장
        </button>
        <button onClick={onClose}>닫기</button>
      </div>

      {/* 대화상자에서 두 가지를 반드시 맞춰야 한다. 안 적어두면 반드시 틀린다. */}
      <div className="pnote">
        인쇄 대화상자에서 <b>여백 = 없음</b>, <b>배경 그래픽 = 켬</b> 을 확인하세요. 크기 조정은{' '}
        <b>100%</b> 여야 합니다 — «페이지에 맞춤» 이면 카드가 작아집니다.
      </div>
      <div className="pnote sub">
        {plan.bleedMode === 'none'
          ? '조각끼리 맞붙어 칼질 한 번에 두 장이 잘립니다. 종이도 제일 적게 듭니다. (도련은 다음 판에서 다시 켭니다)'
          : plan.bleedMode === 'outer'
            ? `맞붙이되 깔린 덩어리의 바깥 네 변에만 ${plan.bleed}mm — 안쪽 이음매는 이웃 조각이 도련 노릇을 하고, 바깥으로 밀려 잘려도 흰 테두리가 안 생깁니다.`
            : `조각마다 사방 ${plan.bleed}mm 를 붙이고 그만큼 띄웁니다. 낱장으로 인쇄소에 맡길 때. 한 장에 들어가는 수가 줄어듭니다.`}
      </div>

      {plan.cols === 0 || plan.rows === 0 ? (
        <p className="pempty">
          조각이 종이보다 큽니다. 조각 크기를 줄이거나 종이 여백을 줄이세요.
        </p>
      ) : (
        <div className="psheets">
          {plan.pages.map((p, i) => (
            <Sheet key={i} plan={plan} page={p} keywords={project.keywords} />
          ))}
        </div>
      )}
    </div>,
    document.body
  )
}
