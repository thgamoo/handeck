/**
 * 룰북 인쇄 — **쪽을 종이에 앉히고, 접거나 묶는다.**
 *
 * 카드 인쇄는 «자를 자리», 보드 인쇄는 «붙일 자리» 를 표시한다.
 * 여기서 표시할 것은 **접을 자리**와, 그보다 중요한 **쪽 번호**다 —
 * 중철은 종이에 8, 1 순으로 깔리므로 미리보기에 번호가 없으면
 * 뽑아놓고도 잘못 접었는지 알 수가 없다.
 */

import { createPortal } from 'react-dom'
import { useEffect } from 'react'
import { Piece } from '../core/render.tsx'
import { planBook, suggestSheet, type BookPlan, type BookSheet } from '../core/booklet.ts'
import { SHEET_PRESETS, type Component, type Keyword, type Project, type Rulebook } from '../core/model.ts'
import { assetUrl } from '../store/assets.ts'
import { useStore } from '../store/project.ts'
import { usePageSize } from './Print.tsx'

const mm = (v: number): string => `${v}mm`

function BookSheetView({
  plan,
  sheet,
  component,
  book,
  keywords,
}: {
  plan: BookPlan
  sheet: BookSheet
  component: Component
  book: Rulebook
  keywords?: Keyword[]
}) {
  return (
    <div className="psheet" style={{ width: mm(plan.sheet.w), height: mm(plan.sheet.h) }}>
      {sheet.slots.map((slot, i) => {
        const page = slot.page ? book.pages[slot.page - 1] : undefined
        return (
          <div key={i} className="pcell" style={{ left: mm(slot.x), top: mm(slot.y) }}>
            {page ? (
              <Piece component={component} instance={page} opts={{ assetUrl, keywords }} />
            ) : (
              // 백지도 **자리를 차지해야** 한다. 안 그리면 접었을 때 어디가 비는지 모른다.
              <div
                className="pblank"
                style={{ width: mm(plan.page.w), height: mm(plan.page.h) }}
              >
                백지
              </div>
            )}
            <span className="pslot">{slot.page ?? '—'}</span>
          </div>
        )
      })}

      {/* 접는 선 — 자르는 선(실선)과 헷갈리면 룰북이 두 동강 난다. 점선으로 긋는다 */}
      {plan.binding === 'saddle' && plan.foldX !== undefined && (
        <div className="fold" style={{ left: mm(plan.foldX) }} />
      )}

      <div className="pfoot">
        {sheet.no}장 {sheet.side === 'back' ? '뒤' : '앞'} ·{' '}
        {sheet.slots.map((s) => s.page ?? '백지').join(' | ')}쪽
      </div>
    </div>
  )
}

export function PrintBookView({
  project,
  book,
  onClose,
}: {
  project: Project
  book: Rulebook
  onClose: () => void
}) {
  const patchRulebook = useStore((st) => st.patchRulebook)
  const component = project.components[book.component]!
  const plan = planBook(component.size, book.sheet, book)
  usePageSize(plan.sheet.w, plan.sheet.h)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const sheetName =
    SHEET_PRESETS.find((x) => x.w === plan.sheet.w && x.h === plan.sheet.h)?.name ??
    `${plan.sheet.w}×${plan.sheet.h}mm`
  const fits = suggestSheet(component.size, plan.binding, SHEET_PRESETS)
  const blanks = plan.padded - plan.count

  return createPortal(
    <div className="printwrap">
      <div className="pbar">
        <b>룰북 인쇄 미리보기</b>
        <span>
          {book.name} · {plan.count}쪽 → 종이 {plan.sheets.length}면 (
          {plan.duplex ? '양면' : '단면'})
        </span>
        <span className="sp" />
        <label className="pbleed">
          제본
          <select
            value={plan.binding}
            onChange={(e) => patchRulebook({ binding: e.target.value as 'saddle' | 'staple' })}
          >
            <option value="saddle">접어서 중철</option>
            <option value="staple">모서리 스테이플</option>
          </select>
        </label>
        <label className="pbleed">
          넘김
          <select
            value={plan.duplex ? (book.duplex === 'long' ? 'long' : 'short') : 'off'}
            onChange={(e) =>
              patchRulebook({ duplex: e.target.value === 'off' ? false : (e.target.value as 'long' | 'short') })
            }
          >
            <option value="short">양면 · 짧은 쪽</option>
            <option value="long">양면 · 긴 쪽</option>
            <option value="off">단면만</option>
          </select>
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
        인쇄 대화상자에서 <b>여백 = 없음</b>, <b>배경 그래픽 = 켬</b>, 크기 조정 <b>100%</b>,
        그리고 <b>종이 크기 {sheetName}</b> 를 고르세요.
        {plan.binding === 'saddle' && (
          <>
            {' '}중철은 종이 한 면에 두 쪽이 눕습니다 — <b>가로 종이</b>가 맞고, 양면은 보통{' '}
            <b>「짧은 쪽으로 넘김」</b>이라야 앞뒤가 맞물립니다. 한 장 뽑아 접어보고 어긋나면
            반대로 바꾸세요.
          </>
        )}
      </div>

      {plan.overflow ? (
        <div className="pnote sub trouble">
          쪽({plan.page.w}×{plan.page.h}mm) {plan.perSide}개가 종이({plan.sheet.w}×{plan.sheet.h}mm)에
          안 들어갑니다 — <b>이대로 뽑으면 잘려 나갑니다.</b>{' '}
          {fits ? (
            <>
              <b>{fits.name}</b> 을 고르면 들어갑니다.
            </>
          ) : (
            <>쪽 크기를 줄이거나 「모서리 스테이플」로 바꾸세요.</>
          )}
        </div>
      ) : plan.binding === 'saddle' ? (
        <div className="pnote sub">
          종이 {plan.sheets.length / (plan.duplex ? 2 : 1)}장을 <b>겹쳐서 반으로 접고</b> 접힌 등에
          스테이플러를 박습니다. 쪽은 <b>바깥 장부터</b> 8·1 / 2·7 처럼 짝지어 깔립니다 — 순서가
          뒤죽박죽으로 보이는 것이 정상입니다.
          {blanks > 0 && (
            <>
              {' '}
              <b>백지 {blanks}쪽</b>이 붙었습니다 (중철은 4의 배수여야 합니다). 뒤에 «메모» 쪽을
              더하면 백지가 줄어듭니다.
            </>
          )}
        </div>
      ) : (
        <div className="pnote sub">
          한 면에 한 쪽씩 차례대로 나옵니다. 뽑은 뒤 <b>왼쪽 위를 스테이플러로</b> 박으면 됩니다.
          {!plan.duplex && ' 단면이라 뒷장은 비어 있습니다.'}
        </div>
      )}

      <div className="psheets">
        {plan.sheets.map((s, i) => (
          <BookSheetView
            key={i}
            plan={plan}
            sheet={s}
            component={component}
            book={book}
            keywords={project.keywords}
          />
        ))}
      </div>
    </div>,
    document.body
  )
}
