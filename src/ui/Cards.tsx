/**
 * 왼쪽 패널 — **목록만** 담당한다.
 *
 * 덱 목록과 카드(인스턴스) 목록. 선택이 여기서 일어나고,
 * 선택한 것의 «내용 편집» 은 전부 오른쪽 패널이 맡는다.
 * (레이어를 고르면 오른쪽에서 고치는 게 그림 편집기의 관례다)
 */

import { useState } from 'react'
import { PIECE_PRESETS, totalPieces } from '../core/model.ts'
import { Piece, fullSize } from '../core/render.tsx'
import { useStore } from '../store/project.ts'
import { assetUrl } from '../store/assets.ts'
import { cssMmPx } from '../store/screen.ts'
import { Keywords } from './Keywords.tsx'

export function Cards() {
  const s = useStore()
  const deck = s.deck()
  const c = s.component()
  const f = fullSize(c)
  const thumbW = 52
  /**
   * 썸네일 배율.
   *
   * [주의] `thumbW / f.w` 가 아니다. `thumbW` 는 **px** 이고 `f.w` 는 **mm** 라
   * 그냥 나누면 단위가 섞인다 (63mm 카드가 0.825 배로 «축소» 돼서 실제로는 238px →
   * 196px, 52px 상자에 들어가지 못하고 왼쪽 위 귀퉁이만 보였다).
   * 화면 보정은 곱하지 않는다 — 썸네일은 실물 크기를 보여주는 자리가 아니다.
   */
  const scale = thumbW / (f.w * cssMmPx())

  const p = s.project
  const [adding, setAdding] = useState(false)
  const [keywords, setKeywords] = useState(false)
  const kwCount = (p.keywords ?? []).filter((k) => k.word.trim()).length
  const [renaming, setRenaming] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [preset, setPreset] = useState(0)
  const make = () => {
    const n = name.trim()
    if (!n) return
    s.addDeck(n, { ...PIECE_PRESETS[preset]!.size })
    setAdding(false)
    setName('')
  }

  const total = totalPieces(deck)
  const off = deck.expect !== undefined && deck.expect !== total

  return (
    <div className="left">
      {/* «+ 덱» 은 제목 옆에 둔다. 목록 아래에 쌓으면 덱이 늘어날수록 멀어진다 */}
      <h4>
        덱
        <button className="h4btn" onClick={() => setAdding(true)}>
          + 덱
        </button>
      </h4>
      {s.project.decks.map((d, n) => (
        <div
          key={d.id}
          className={`deck${d.id === s.deckId ? ' on' : ''}`}
          onClick={() => s.selectDeck(d.id)}
          onDoubleClick={() => setRenaming(d.id)}
          title="두 번 누르면 이름을 바꿉니다"
        >
          {renaming === d.id ? (
            <input
              autoFocus
              className="rn"
              defaultValue={d.name}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v) s.renameDeck(d.id, v)
                setRenaming(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setRenaming(null)
              }}
            />
          ) : (
            <>
              {d.name}
              <span className="dim">
                {p.components[d.component]?.size.w}×{p.components[d.component]?.size.h}
              </span>
              <span className="n">{totalPieces(d)}</span>
              {/* 보이는 순서가 곧 작업 순서다 — 어느 덱을 먼저 보느냐가 중요하다 */}
              <button
                className="mv"
                title="위로"
                disabled={n === 0}
                onClick={(e) => {
                  e.stopPropagation()
                  s.moveDeck(d.id, -1)
                }}
              >
                ▲
              </button>
              <button
                className="mv"
                title="아래로"
                disabled={n === p.decks.length - 1}
                onClick={(e) => {
                  e.stopPropagation()
                  s.moveDeck(d.id, 1)
                }}
              >
                ▼
              </button>
              <button
                className="del"
                title="덱 삭제"
                disabled={s.project.decks.length <= 1}
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm(`«${d.name}» 덱을 지웁니다. 되돌리기로 복구할 수 있습니다.`)) s.removeDeck(d.id)
                }}
              >
                ✕
              </button>
            </>
          )}
        </div>
      ))}

      {adding && (
        <div className="newdeck">
          <input
            autoFocus
            placeholder="덱 이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') make()
              if (e.key === 'Escape') setAdding(false)
            }}
          />
          <select value={preset} onChange={(e) => setPreset(Number(e.target.value))}>
            {PIECE_PRESETS.map((x, i) => (
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

      <div className="rowbtn tight">
        {/* 보드게임 구성품은 서로 비슷하다 — 새로 짜는 것보다 베껴 고치는 쪽이 빠르다.
            틀·뒷면·종이 설정까지 통째로 복사되고, 원본과 공유하지 않는다. */}
        <button
          title={`«${deck.name}» 을 통째로 복제합니다 (틀·뒷면·카드·인쇄 설정까지)`}
          onClick={() => s.duplicateDeck(s.deckId)}
        >
          덱 복제
        </button>
      </div>
      <div className="rowbtn tight">
        <button
          title="카드 글에 나오면 자동으로 다르게 그려질 낱말을 정합니다 (칩·진하게·색)"
          onClick={() => setKeywords(true)}
        >
          키워드
          {kwCount > 0 && <span className="badge">{kwCount}</span>}
        </button>
      </div>

      {keywords && <Keywords onClose={() => setKeywords(false)} />}

      <h4>
        카드
        <span className={`count${off ? ' warn' : ''}`}>
          {total}
          {deck.expect !== undefined ? ` / ${deck.expect}` : ''}
        </span>
      </h4>

      <div className="cards">
        {deck.instances.map((i, n) => (
          <button
            key={i.id}
            className={`card${i.id === s.instanceId ? ' on' : ''}`}
            onClick={() => s.selectInstance(i.id)}
            title={`카드 ${n + 1}`}
          >
            <div className="thumb" style={{ width: thumbW, height: f.h * cssMmPx() * scale }}>
              <div style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }}>
                <Piece component={c} instance={i} opts={{ assetUrl, keywords: p.keywords }} />
              </div>
            </div>
            <span className="idx">{n + 1}</span>
            {i.qty > 1 && <span className="qty">×{i.qty}</span>}
          </button>
        ))}
      </div>

      <div className="rowbtn pad">
        <button onClick={s.addInstance}>+ 카드</button>
        <button disabled={!s.instanceId} onClick={() => s.instanceId && s.duplicateInstance(s.instanceId)}>
          복제
        </button>
        <button
          className="danger"
          disabled={!s.instanceId}
          onClick={() => s.instanceId && s.removeInstance(s.instanceId)}
        >
          삭제
        </button>
      </div>
    </div>
  )
}
