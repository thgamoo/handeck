/**
 * 왼쪽 패널 — **보드 목록.** 덱 목록(`Cards.tsx`)과 같은 자리를 쓰고,
 * 머리말의 탭으로 갈아 끼운다.
 *
 * 덱 쪽에 있는 «카드 목록» 이 여기엔 없다. 보드는 틀이 곧 결과물이라
 * 목록이 한 겹이면 충분하다.
 */

import { useState } from 'react'
import { BOARD_PRESETS } from '../core/model.ts'
import { Piece } from '../core/render.tsx'
import { useStore } from '../store/project.ts'
import { assetUrl } from '../store/assets.ts'
import { cssMmPx } from '../store/screen.ts'
import { Keywords } from './Keywords.tsx'

export function Boards() {
  const s = useStore()
  const p = s.project
  const boards = p.boards ?? []
  const b = s.board()
  const c = b ? p.components[b.component] : undefined

  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [preset, setPreset] = useState(2) // A3 세로 — 판은 이 크기가 가장 흔하다
  const [renaming, setRenaming] = useState<string | null>(null)
  const [keywords, setKeywords] = useState(false)
  const kwCount = (p.keywords ?? []).filter((k) => k.word.trim()).length

  // 순서 바꾸기 — 덱 목록과 같은 방식 (끌어서)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [after, setAfter] = useState(false)
  const drop = () => {
    if (dragId && overId && dragId !== overId) {
      const ids = boards.map((x) => x.id).filter((id) => id !== dragId)
      ids.splice(ids.indexOf(overId) + (after ? 1 : 0), 0, dragId)
      s.setBoardOrder(ids)
    }
    setDragId(null)
    setOverId(null)
  }

  const make = () => {
    const n = name.trim()
    if (!n) return
    s.addBoard(n, { ...BOARD_PRESETS[preset]!.size })
    setAdding(false)
    setName('')
  }

  // 미리보기 — 판은 카드보다 훨씬 커서 같은 배율을 쓰면 목록이 무너진다.
  // 폭을 고정하고 높이를 비율로 따라가게 한다.
  const thumbW = 84
  const scale = c ? thumbW / (c.size.w * cssMmPx()) : 1

  return (
    <div className="left">
      <h4>
        보드
        <button className="h4btn" onClick={() => setAdding(true)}>
          + 보드
        </button>
      </h4>

      <div className="decks" onDragEnd={() => (setDragId(null), setOverId(null))}>
        {boards.map((x) => {
          const xc = p.components[x.component]
          const tiled = (x.tiling ?? 'single') === 'tile'
          return (
            <div
              key={x.id}
              draggable={renaming !== x.id}
              className={
                `deck${x.id === s.boardId ? ' on' : ''}` +
                `${dragId === x.id ? ' dragging' : ''}` +
                `${overId === x.id ? (after ? ' drop-after' : ' drop-before') : ''}`
              }
              onClick={() => s.selectBoard(x.id)}
              onDoubleClick={() => setRenaming(x.id)}
              title="두 번 누르면 이름을 바꿉니다 · 끌어서 순서를 바꿉니다"
              onDragStart={(e) => {
                setDragId(x.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                e.preventDefault()
                if (!dragId || dragId === x.id) return
                const r = e.currentTarget.getBoundingClientRect()
                setOverId(x.id)
                setAfter(e.clientY > r.top + r.height / 2)
              }}
              onDrop={(e) => {
                e.preventDefault()
                drop()
              }}
            >
              {renaming === x.id ? (
                <input
                  autoFocus
                  className="rn"
                  defaultValue={x.name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    if (v) s.renameBoard(x.id, v)
                    setRenaming(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                />
              ) : (
                <>
                  <span className="grip" title="끌어서 순서 바꾸기">⠿</span>
                  {x.name}
                  <span className="dim">
                    {xc?.size.w}×{xc?.size.h}
                  </span>
                  {/* 종이가 판과 다르면 그게 이 보드의 성격이다 — «A3 판을 A4 로 나눠 뽑는 중» */}
                  <span className="n" title={tiled ? '여러 장에 나눠 뽑습니다' : '한 장에 그대로 뽑습니다'}>
                    {tiled ? '나눔' : '한장'}
                  </span>
                  <button
                    className="del"
                    title="보드 삭제"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm(`«${x.name}» 보드를 지웁니다. 되돌리기로 복구할 수 있습니다.`))
                        s.removeBoard(x.id)
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

      {boards.length === 0 && !adding && (
        <p className="hint sm">
          보드는 <b>한 장짜리 큰 인쇄물</b>입니다 — 판, 참조표, 점수판 같은 것.
          카드처럼 여러 장을 찍는 물건이 아니라서 카드 목록이 없습니다.
          A3 판을 A3 종이에 통째로 뽑거나, A4 여러 장에 나눠 뽑아 이어 붙일 수 있습니다.
        </p>
      )}

      {adding && (
        <div className="newdeck">
          <input
            autoFocus
            placeholder="보드 이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') make()
              if (e.key === 'Escape') setAdding(false)
            }}
          />
          <select value={preset} onChange={(e) => setPreset(Number(e.target.value))}>
            {BOARD_PRESETS.map((x, i) => (
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

      {b && (
        <>
          <div className="rowbtn tight">
            <button
              title={`«${b.name}» 을 통째로 복제합니다 (틀·종이 설정까지)`}
              onClick={() => s.duplicateBoard(b.id)}
            >
              보드 복제
            </button>
          </div>
          <div className="rowbtn tight">
            <button
              title="글에 나오면 자동으로 다르게 그려질 낱말을 정합니다 — 카드와 같은 목록을 씁니다"
              onClick={() => setKeywords(true)}
            >
              키워드
              {kwCount > 0 && <span className="badge">{kwCount}</span>}
            </button>
          </div>

          <h4>미리보기</h4>
          {c && (
            <div className="bprev">
              <div style={{ width: thumbW, height: c.size.h * cssMmPx() * scale }}>
                <div style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }}>
                  <Piece component={c} opts={{ assetUrl, keywords: p.keywords }} />
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {keywords && <Keywords onClose={() => setKeywords(false)} />}
    </div>
  )
}
