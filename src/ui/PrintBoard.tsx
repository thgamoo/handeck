/**
 * 보드 인쇄 — **한 장짜리 큰 인쇄물**을 종이에 앉힌다.
 *
 * 카드 인쇄(`Print.tsx`)와 화면은 닮았지만 하는 일이 반대다.
 * 저쪽은 조각을 격자로 깔고 **자를 자리**를 표시하고, 여기는 판을 잘라 나눠 뽑고
 * **붙일 자리**를 표시한다.
 *
 * A3 를 A3 로 뽑는 길과 A4 여러 장으로 뽑는 길이 둘 다 필요하다 —
 * 판은 A3 인데 집 프린터는 대개 A4 까지라서, 어느 한쪽만 있으면 반쪽이다.
 */

import { createPortal } from 'react-dom'
import { useEffect } from 'react'
import { Piece } from '../core/render.tsx'
import { tileBoard, type TilePage, type TilePlan } from '../core/tile.ts'
import { SHEET_PRESETS, type Board, type Component, type Keyword, type Project } from '../core/model.ts'
import { assetUrl } from '../store/assets.ts'
import { useStore } from '../store/project.ts'
import { usePageSize } from './Print.tsx'

const mm = (v: number): string => `${v}mm`

/**
 * 종이 한 장.
 *
 * 판 전체를 그려놓고 `-x, -y` 만큼 밀어 **인쇄 영역 상자로 잘라낸다.**
 * 장마다 다시 그리는 게 아니라 «같은 그림을 다른 창으로 본다» 는 뜻이라,
 * 이음매에서 글자 굵기나 색이 미묘하게 갈리는 일이 없다.
 */
function BoardSheet({
  plan,
  page,
  component,
  keywords,
}: {
  plan: TilePlan
  page: TilePage
  component: Component
  keywords?: Keyword[]
}) {
  const tiled = plan.pages.length > 1
  return (
    <div className="psheet" style={{ width: mm(plan.sheet.w), height: mm(plan.sheet.h) }}>
      {/* 창을 놓는 자리는 조판이 정한다 — 한 장이면 가운데, 나눠 뽑으면 여백 자리.
          여기서 `margin` 을 직접 더하면 A3 판이 A3 종이에서 여백만큼 잘려 나간다. */}
      <div
        className="bwin"
        style={{
          left: mm(page.px),
          top: mm(page.py),
          width: mm(Math.min(page.w, plan.board.w - page.x)),
          height: mm(Math.min(page.h, plan.board.h - page.y)),
        }}
      >
        <div style={{ position: 'absolute', left: mm(-page.x), top: mm(-page.y) }}>
          <Piece component={component} opts={{ assetUrl, keywords }} />
        </div>
      </div>

      {/* 붙일 자리 — 이웃이 있는 변에만. 겹침 폭만큼 안쪽으로 들어온 선이
          «여기까지가 겹치는 부분» 이다. 위에 얹을 장을 이 선에 맞추면 된다. */}
      {tiled && page.edges.right && (
        <div className="glue v" style={{ left: mm(page.px + page.w - plan.overlapX), top: mm(page.py), height: mm(page.h) }} />
      )}
      {tiled && page.edges.left && (
        <div className="glue v" style={{ left: mm(page.px + plan.overlapX), top: mm(page.py), height: mm(page.h) }} />
      )}
      {tiled && page.edges.bottom && (
        <div className="glue h" style={{ top: mm(page.py + page.h - plan.overlapY), left: mm(page.px), width: mm(page.w) }} />
      )}
      {tiled && page.edges.top && (
        <div className="glue h" style={{ top: mm(page.py + plan.overlapY), left: mm(page.px), width: mm(page.w) }} />
      )}

      <div className="pfoot">
        {tiled
          ? `${page.row + 1}행 ${page.col + 1}열 (${plan.rows}×${plan.cols}) · ${page.no}/${plan.pages.length}쪽`
          : `${plan.board.w}×${plan.board.h}mm · 한 장`}
      </div>
    </div>
  )
}

export function PrintBoardView({
  project,
  board,
  onClose,
}: {
  project: Project
  board: Board
  onClose: () => void
}) {
  const patchBoard = useStore((st) => st.patchBoard)
  const component = project.components[board.component]!
  const plan = tileBoard(component.size, board.sheet, board)
  usePageSize(plan.sheet.w, plan.sheet.h)

  /**
   * 이 판이 들어가는 가장 작은 종이.
   *
   * «크다» 만 말하고 끝내면 사용자가 목록을 하나씩 눌러보게 된다.
   * 회전은 목록에 가로·세로가 따로 있으므로 저절로 걸린다.
   */
  /** 지금 고른 종이의 이름. 인쇄 대화상자에서 이걸 그대로 고르라고 말해야 한다 */
  const sheetName =
    SHEET_PRESETS.find((x) => x.w === plan.sheet.w && x.h === plan.sheet.h)?.name ??
    `${plan.sheet.w}×${plan.sheet.h}mm`

  const fits = SHEET_PRESETS.filter(
    (x) => component.size.w <= x.w + 1e-9 && component.size.h <= x.h + 1e-9
  ).sort((a, b) => a.w * a.h - b.w * b.h)[0]

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  return createPortal(
    <div className="printwrap">
      <div className="pbar">
        <b>보드 인쇄 미리보기</b>
        <span>
          {board.name} · 판 {plan.board.w}×{plan.board.h}mm → 종이 {plan.sheet.w}×{plan.sheet.h}mm{' '}
          {plan.pages.length}쪽
        </span>
        <span className="sp" />
        <label className="pbleed">
          앉히기
          <select
            value={board.tiling ?? 'single'}
            onChange={(e) => patchBoard({ tiling: e.target.value as 'single' | 'tile' })}
          >
            <option value="single">한 장에 그대로</option>
            <option value="tile">나눠 뽑아 이어 붙이기</option>
          </select>
          {(board.tiling ?? 'single') === 'tile' && (
            <input
              type="number"
              min={0}
              step={1}
              title="겹침 (mm) — 이웃 장과 겹쳐 찍어 풀칠할 자리"
              value={board.overlap ?? 10}
              onChange={(e) => patchBoard({ overlap: Math.max(0, Number(e.target.value) || 0) })}
            />
          )}
        </label>
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

      <div className="pnote">
        인쇄 대화상자에서 <b>여백 = 없음</b>, <b>배경 그래픽 = 켬</b>, 크기 조정 <b>100%</b> 를
        확인하세요. 그리고 <b>종이 크기를 {sheetName} 로</b> 골라야 합니다 — 대화상자가 A4 인
        채로 두면 그 안에 맞춰 줄어들거나 잘립니다. 프린터가 A4 까지면
        「나눠 뽑아 이어 붙이기」로 바꾸세요.
      </div>

      {plan.overflow ? (
        <div className="pnote sub trouble">
          판({plan.board.w}×{plan.board.h}mm)이 종이({plan.sheet.w}×{plan.sheet.h}mm)보다 큽니다 —{' '}
          <b>이대로 뽑으면 사방이 고르게 잘려 나갑니다.</b>{' '}
          {fits ? (
            <>
              <b>{fits.name}</b> 을 고르면 들어갑니다.
            </>
          ) : (
            <>목록의 어느 종이에도 안 들어갑니다 — 「나눠 뽑아 이어 붙이기」를 쓰세요.</>
          )}
        </div>
      ) : !plan.single && plan.pages.length === 1 ? (
        <div className="pnote sub">
          종이에는 들어가지만 <b>여백({plan.sheet.margin}mm) 안쪽을 넘습니다.</b> 판은 가운데
          앉히므로 이대로 뽑히지만, 프린터가 가장자리까지 못 찍는 기종이면 테두리가 조금 잘릴 수
          있습니다. 「가장자리 없음 / 여백 없음」으로 인쇄하세요.
        </div>
      ) : plan.pages.length > 1 ? (
        <div className="pnote sub">
          {plan.rows}×{plan.cols} = {plan.pages.length}장으로 나눴습니다. 이웃끼리 가로{' '}
          {Math.round(plan.overlapX * 10) / 10}mm · 세로 {Math.round(plan.overlapY * 10) / 10}mm 씩
          겹쳐 찍히니, <b>점선까지 겹치게</b> 얹어 붙이면 됩니다. 왼쪽 위 장부터 행 순서로 나옵니다.
        </div>
      ) : (
        <div className="pnote sub">한 장에 그대로 들어갑니다. 자르거나 붙일 것이 없습니다.</div>
      )}

      <div className="psheets">
        {plan.pages.map((p) => (
          <BoardSheet key={p.no} plan={plan} page={p} component={component} keywords={project.keywords} />
        ))}
      </div>
    </div>,
    document.body
  )
}
