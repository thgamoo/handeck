/**
 * 왼쪽 패널 — **룰북 목록과 쪽 목록.**
 *
 * 덱 목록(`Cards.tsx`)과 같은 자리를 쓴다. 다른 점은 두 가지다:
 *   ① 목록이 **순서 그 자체**다. 카드 순서는 인쇄할 때나 의미가 있지만
 *      쪽 순서는 곧 읽는 순서라, 옮기는 단추가 목록 안에 있어야 한다.
 *   ② **원고 가져오기**가 «새로 만들기» 옆에 나란히 있다. 룰북을 상자부터
 *      놓아 만드는 사람은 없다 — 글은 이미 어딘가에 마크다운으로 있다.
 */

import { useState } from 'react'
import { PAGE_PRESETS, type SheetSpec } from '../core/model.ts'
import { bodyFit, parseRulebookSource, type SplitMode } from '../core/rulebook.ts'
import { Piece } from '../core/render.tsx'
import { useStore } from '../store/project.ts'
import { assetUrl } from '../store/assets.ts'
import { cssMmPx } from '../store/screen.ts'
import { Keywords } from './Keywords.tsx'

const sheetOf = (p: { sheet: { w: number; h: number } }): SheetSpec => ({
  w: p.sheet.w,
  h: p.sheet.h,
  margin: 0,
  gap: 0,
  marks: 'none',
})

export function Books() {
  const s = useStore()
  const p = s.project
  const books = p.rulebooks ?? []
  const b = s.rulebook()
  const c = b ? p.components[b.component] : undefined

  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [name, setName] = useState('')
  const [preset, setPreset] = useState(0) // A5 — 집에서 A4 에 접어 만드는 가장 흔한 크기
  const [renaming, setRenaming] = useState<string | null>(null)
  const [keywords, setKeywords] = useState(false)
  const kwCount = (p.keywords ?? []).filter((k) => k.word.trim()).length

  // 쪽 순서 바꾸기 — 끌어서
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [after, setAfter] = useState(false)
  const dropPage = () => {
    if (b && dragId && overId && dragId !== overId) {
      const ids = b.pages.map((x) => x.id).filter((id) => id !== dragId)
      ids.splice(ids.indexOf(overId) + (after ? 1 : 0), 0, dragId)
      s.setPageOrder(ids)
    }
    setDragId(null)
    setOverId(null)
  }

  const make = () => {
    const n = name.trim()
    if (!n) return
    const preset0 = PAGE_PRESETS[preset]!
    s.addRulebook(n, { ...preset0.size }, sheetOf(preset0))
    setAdding(false)
    setName('')
  }

  const thumbW = 84
  const scale = c ? thumbW / (c.size.w * cssMmPx()) : 1

  return (
    <div className="left">
      <h4>
        룰북
        <button className="h4btn" onClick={() => setImporting(true)} title="마크다운·JSON 원고에서 쪽을 만들어 가져옵니다">
          원고 가져오기
        </button>
        <button className="h4btn" onClick={() => setAdding(true)}>
          + 룰북
        </button>
      </h4>

      <div className="decks">
        {books.map((x) => {
          const xc = p.components[x.component]
          return (
            <div
              key={x.id}
              className={`deck${x.id === s.bookId ? ' on' : ''}`}
              onClick={() => s.selectRulebook(x.id)}
              onDoubleClick={() => setRenaming(x.id)}
              title="두 번 누르면 이름을 바꿉니다"
            >
              {renaming === x.id ? (
                <input
                  autoFocus
                  className="rn"
                  defaultValue={x.name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    if (v) s.renameRulebook(x.id, v)
                    setRenaming(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                />
              ) : (
                <>
                  {x.name}
                  <span className="dim">
                    {xc?.size.w}×{xc?.size.h}
                  </span>
                  <span className="n" title={(x.binding ?? 'saddle') === 'saddle' ? '접어서 중철' : '모서리 스테이플'}>
                    {x.pages.length}쪽
                  </span>
                  <button
                    className="del"
                    title="룰북 삭제"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm(`«${x.name}» 룰북을 지웁니다. 되돌리기로 복구할 수 있습니다.`))
                        s.removeRulebook(x.id)
                    }}
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>

      {books.length === 0 && !adding && !importing && (
        <p className="hint sm">
          룰북은 <b>여러 쪽짜리 인쇄물</b>입니다 — 설명서, 시나리오 책자 같은 것.
          매끈한 종이에 뽑아 <b>반으로 접거나 스테이플러로</b> 묶습니다.
          이미 마크다운으로 써둔 규칙 문서가 있다면 <b>「원고 가져오기」</b> 가 빠릅니다.
        </p>
      )}

      {adding && (
        <div className="newdeck">
          <input
            autoFocus
            placeholder="룰북 이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') make()
              if (e.key === 'Escape') setAdding(false)
            }}
          />
          <select value={preset} onChange={(e) => setPreset(Number(e.target.value))}>
            {PAGE_PRESETS.map((x, i) => (
              <option key={x.name} value={i}>
                {x.name}
              </option>
            ))}
          </select>
          <div className="rowbtn tight">
            <button onClick={make} disabled={!name.trim()}>
              만들기
            </button>
            <button onClick={() => setAdding(false)}>취소</button>
          </div>
        </div>
      )}

      {b && c && (
        <>
          <h4>
            쪽
            <span className="allcards">{b.pages.length}쪽</span>
            <button className="h4btn" onClick={s.addPage}>
              + 쪽
            </button>
          </h4>

          <div className="pages" onDragEnd={() => (setDragId(null), setOverId(null))}>
            {b.pages.map((pg, i) => {
              const fit = bodyFit(c, pg)
              const title = pg.values['title'] || '(제목 없음)'
              return (
                <div
                  key={pg.id}
                  draggable
                  className={
                    `pageitem${pg.id === (s.page()?.id ?? '') ? ' on' : ''}` +
                    `${dragId === pg.id ? ' dragging' : ''}` +
                    `${overId === pg.id ? (after ? ' drop-after' : ' drop-before') : ''}`
                  }
                  onClick={() => s.selectPage(pg.id)}
                  onDragStart={(e) => {
                    setDragId(pg.id)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    if (!dragId || dragId === pg.id) return
                    const r = e.currentTarget.getBoundingClientRect()
                    setOverId(pg.id)
                    setAfter(e.clientY > r.top + r.height / 2)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    dropPage()
                  }}
                  title="끌어서 쪽 순서를 바꿉니다"
                >
                  <span className="pno">{i + 1}</span>
                  <span className="ptitle">{title}</span>
                  {/* 넘침은 **종이에서 잘려 나간다.** 화면에서는 그냥 안 보일 뿐이라
                      여기서 미리 말해주지 않으면 인쇄하고 나서야 안다. */}
                  {fit?.over && (
                    <span className="over" title={`본문이 상자를 넘칩니다 (약 ${Math.round(fit.lines)}줄 / ${Math.round(fit.capacity)}줄)`}>
                      넘침
                    </span>
                  )}
                  <button
                    className="del"
                    title="이 쪽 삭제"
                    onClick={(e) => {
                      e.stopPropagation()
                      s.removePage(pg.id)
                    }}
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>

          <div className="rowbtn tight">
            <button
              disabled={!s.page()}
              onClick={() => s.page() && s.duplicatePage(s.page()!.id)}
              title="이 쪽을 복제합니다"
            >
              쪽 복제
            </button>
            <button
              onClick={s.renumberPages}
              title="쪽번호를 지금 순서대로 다시 매깁니다 (표지는 비웁니다)"
            >
              쪽번호 다시
            </button>
          </div>
          <div className="rowbtn tight">
            <button title={`«${b.name}» 을 통째로 복제합니다`} onClick={() => s.duplicateRulebook(b.id)}>
              룰북 복제
            </button>
            <button onClick={() => setKeywords(true)}>
              키워드
              {kwCount > 0 && <span className="badge">{kwCount}</span>}
            </button>
          </div>

          <h4>미리보기</h4>
          <div className="bprev">
            <div style={{ width: thumbW, height: c.size.h * cssMmPx() * scale }}>
              <div style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }}>
                <Piece component={c} instance={s.page()} opts={{ assetUrl, keywords: p.keywords }} />
              </div>
            </div>
          </div>
        </>
      )}

      {keywords && <Keywords onClose={() => setKeywords(false)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </div>
  )
}

/**
 * 원고 가져오기.
 *
 * **파일과 붙여넣기를 둘 다 받는다.** 원고는 저장소 안에 있기도 하고
 * (`sub3/docs/rulebook.md`) 편집기 창에 열려 있기도 하다.
 * 확장자는 안 본다 — 내용 첫 글자가 `{` 나 `[` 면 JSON 이다.
 */
function ImportDialog({ onClose }: { onClose: () => void }) {
  const s = useStore()
  const [text, setText] = useState('')
  const [split, setSplit] = useState<SplitMode>('hr')
  const [preset, setPreset] = useState(0)
  const [columns, setColumns] = useState(1)
  const [binding, setBinding] = useState<'saddle' | 'staple'>('saddle')

  const doc = text.trim() ? parseRulebookSource(text, split) : null

  const run = () => {
    if (!doc || !doc.pages.length) return
    const preset0 = PAGE_PRESETS[preset]!
    s.importRulebook(doc, {
      size: { ...preset0.size },
      sheet: sheetOf(preset0),
      binding,
      columns,
      name: doc.title,
    })
    onClose()
  }

  return (
    <div className="modal" onMouseDown={onClose}>
      <div className="sheetbox wide" onMouseDown={(e) => e.stopPropagation()}>
        <h3>원고 가져오기</h3>
        <p className="hint sm nopad">
          마크다운이나 JSON 을 그대로 넣습니다. <b>가로줄(<code>---</code>) 한 줄이 쪽 나눔</b>이고,
          각 쪽의 <b>첫 헤딩이 그 쪽의 제목</b>이 됩니다. <code>&lt;!-- --&gt;</code> 주석은 인쇄되지 않습니다.
        </p>

        <div className="rowbtn tight">
          <label className="f">
            <span>쪽 나눔</span>
            <select value={split} onChange={(e) => setSplit(e.target.value as SplitMode)}>
              <option value="hr">--- 가로줄마다</option>
              <option value="h2">## 소제목마다</option>
            </select>
          </label>
          <label className="f">
            <span>쪽 크기</span>
            <select value={preset} onChange={(e) => setPreset(Number(e.target.value))}>
              {PAGE_PRESETS.map((x, i) => (
                <option key={x.name} value={i}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="rowbtn tight">
          <label className="f">
            <span>제본</span>
            <select value={binding} onChange={(e) => setBinding(e.target.value as 'saddle' | 'staple')}>
              <option value="saddle">접어서 중철</option>
              <option value="staple">모서리 스테이플</option>
            </select>
          </label>
          <label className="f">
            <span>단</span>
            <select value={columns} onChange={(e) => setColumns(Number(e.target.value))}>
              <option value={1}>한 단</option>
              <option value={2}>두 단</option>
            </select>
          </label>
        </div>

        <input
          type="file"
          accept=".md,.markdown,.txt,.json,text/markdown,text/plain,application/json"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) setText(await f.text())
          }}
        />

        <textarea
          className="mdin"
          placeholder="여기에 원고를 붙여넣어도 됩니다"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        {doc && (
          <p className="hint sm nopad">
            <b>{doc.pages.length}쪽</b> — {doc.pages.slice(0, 6).map((p) => p.title || '(무제)').join(' · ')}
            {doc.pages.length > 6 ? ' …' : ''}
            {doc.warnings.map((w) => (
              <span key={w} className="trouble">
                {' '}
                ⚠ {w}
              </span>
            ))}
          </p>
        )}

        <div className="rowbtn">
          <button className="go" disabled={!doc?.pages.length} onClick={run}>
            {doc?.pages.length ? `${doc.pages.length}쪽 가져오기` : '가져오기'}
          </button>
          <button onClick={onClose}>취소</button>
        </div>
      </div>
    </div>
  )
}
