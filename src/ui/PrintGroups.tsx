/**
 * 인쇄 묶기 — 여러 덱을 한 종이에 이어 깔기.
 *
 * 덱마다 따로 뽑으면 마지막 장이 늘 반쯤 빈다. 10장짜리 덱 다섯 개면 A4 다섯 장인데
 * (9칸 중 1칸씩만 쓰고 버림) 묶으면 50장 = **여섯 장**이면 된다.
 * 시제품을 여러 번 뽑는 초기 단계에서는 이 차이가 크다.
 *
 * **규격이 같은 덱만 묶을 수 있다.** 칸 크기가 다르면 한 격자에 못 깐다.
 * 그래서 목록을 규격별로 나눠 보여주고, 규격이 다른 덱은 아예 고를 수 없게 한다.
 */

import { useState } from 'react'
import { useStore } from '../store/project.ts'
import { groupColor, groupOf, GROUP_COLORS, totalPieces, type Deck } from '../core/model.ts'
import { imposeDecks, layout } from '../core/impose.ts'
import { Printer } from './icons.tsx'

export function PrintGroups({ onClose }: { onClose: () => void }) {
  const s = useStore()
  const p = s.project
  const groups = p.printGroups ?? []
  const [name, setName] = useState('')

  /** 이 덱의 규격 — 같은 규격끼리만 묶인다 */
  const sizeKey = (d: Deck) => {
    const c = p.components[d.component]
    return c ? `${c.size.w}×${c.size.h}${c.size.shape === 'circle' ? ' 원형' : ''}` : '?'
  }

  /** 묶었을 때 종이가 몇 장 줄어드는지 — 이게 이 기능의 존재 이유다 */
  const saving = (decks: Deck[]) => {
    if (decks.length < 2) return null
    const apart = decks.reduce((n, d) => n + imposeDecks(p, [d]).pages.length, 0)
    const together = imposeDecks(p, decks).pages.length
    return { apart, together, saved: apart - together }
  }

  const byGroup = new Map<string, Deck[]>()
  for (const d of p.decks) {
    const g = groupOf(p, d.id)
    if (!g) continue
    byGroup.set(g.id, [...(byGroup.get(g.id) ?? []), d])
  }

  return (
    <div className="modal" onMouseDown={onClose}>
      <div className="sheetbox" onMouseDown={(e) => e.stopPropagation()}>
        <h3>프린트묶기</h3>
        <p className="hint nopad">
          여러 덱을 <b>한 종이에 이어서</b> 깝니다. 덱마다 따로 뽑으면 마지막 장이 늘 반쯤 비는데,
          묶으면 그 빈 칸을 다음 덱이 채웁니다. <b>규격이 같은 덱끼리만</b> 묶을 수 있습니다.
        </p>

        {groups.length === 0 && <p className="hint sm">아직 묶음이 없습니다. 아래에서 만드세요.</p>}

        {groups.map((g, gi) => {
          const mine = byGroup.get(g.id) ?? []
          const key = mine.length > 0 ? sizeKey(mine[0]!) : null
          const save = saving(mine)
          return (
            <div key={g.id} className="pgbox">
              <div className="pghead">
                {/* 묶음이 여럿이면 목록에서 색으로 구분한다 */}
                <span className="pgmark on" style={{ color: groupColor(g, gi) }}>
                  <Printer size={15} title={`${g.name} 색`} />
                </span>
                <input
                  className="pgname"
                  value={g.name}
                  onChange={(e) => s.renamePrintGroup(g.id, e.target.value)}
                />
                <span className="pgcolors">
                  {GROUP_COLORS.map((col) => (
                    <button
                      key={col}
                      className={groupColor(g, gi) === col ? 'on' : ''}
                      style={{ background: col }}
                      title="묶음 색"
                      onClick={() => s.setPrintGroupColor(g.id, col)}
                    />
                  ))}
                </span>
                <span className="pgstat">
                  {mine.length}덱 · {mine.reduce((n, d) => n + totalPieces(d), 0)}장
                  {save && save.saved > 0 && <b> · 종이 {save.saved}장 아낌</b>}
                  {save && save.saved === 0 && <em> · 아끼는 종이 없음</em>}
                </span>
                <button className="del" title="묶음 지우기" onClick={() => s.removePrintGroup(g.id)}>
                  ✕
                </button>
              </div>

              <div className="pgdecks">
                {p.decks.map((d) => {
                  const here = mine.some((x) => x.id === d.id)
                  const other = groupOf(p, d.id)
                  // 규격이 다르면 못 넣는다. 이미 다른 묶음에 든 덱도 마찬가지.
                  const wrongSize = key !== null && sizeKey(d) !== key && !here
                  const taken = !!other && other.id !== g.id
                  const blocked = wrongSize || taken
                  return (
                    <label
                      key={d.id}
                      className={`pgdeck${blocked ? ' off' : ''}`}
                      title={
                        wrongSize
                          ? `규격이 다릅니다 (${sizeKey(d)} ≠ ${key})`
                          : taken
                            ? `이미 «${other!.name}» 에 들어 있습니다`
                            : ''
                      }
                    >
                      <input
                        type="checkbox"
                        checked={here}
                        disabled={blocked}
                        onChange={(e) => s.setDeckGroup(d.id, e.target.checked ? g.id : null)}
                      />
                      {d.name}
                      <span className="sz">{sizeKey(d)}</span>
                    </label>
                  )
                })}
              </div>

              {save && (
                <p className="hint sm nopad">
                  따로 뽑으면 {save.apart}쪽 · 묶으면 <b>{save.together}쪽</b>
                  {mine.length > 0 &&
                    ` · 한 장에 ${(() => {
                      const c = p.components[mine[0]!.component]
                      if (!c) return '?'
                      const g2 = layout(c.size, mine[0]!.sheet)
                      return `${g2.cols}×${g2.rows}`
                    })()}칸`}
                </p>
              )}
            </div>
          )
        })}

        <div className="cfree">
          <input
            placeholder="새 묶음 이름 (예: 토큰 묶음)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) {
                s.addPrintGroup(name.trim())
                setName('')
              }
            }}
          />
          <button
            disabled={!name.trim()}
            onClick={() => {
              s.addPrintGroup(name.trim())
              setName('')
            }}
          >
            + 묶음
          </button>
          <span className="grow" />
          <button className="go" onClick={onClose}>
            닫기
          </button>
        </div>

        <p className="hint sm nopad">
          묶인 덱은 아무거나 «인쇄 / PDF» 를 눌러도 <b>묶음 전체</b>가 나옵니다.
          뒷면은 덱마다 달라도 됩니다 — 칸마다 자기 뒷면을 들고 갑니다.
        </p>
      </div>
    </div>
  )
}
