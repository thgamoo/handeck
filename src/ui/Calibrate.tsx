/**
 * 화면 실물 크기 맞추기.
 *
 * 브라우저는 자기 화면이 실제로 몇 인치인지 모른다 (CSS 는 1인치를 96px 로 «정해» 둔다).
 * 그래서 «100%» 가 자로 잰 63×88mm 와 안 맞는 게 정상이다. 사람이 한 번 재주면
 * 그 다음부터는 맞는다.
 *
 * 재는 방법을 두 가지 준다. 자가 없을 때가 더 많아서다.
 *   1. 자 — 화면의 막대를 재서 나온 길이를 적는다
 *   2. 카드 — 신용카드를 화면에 대고 테두리가 맞을 때까지 민다 (85.6 × 53.98mm, ISO/IEC 7810 ID-1)
 */

import { useState } from 'react'
import { cssMmPx, resetScreenScale, screenScale, setScreenScale } from '../store/screen.ts'

/** 화면에 그릴 자의 길이 (mm) */
const RULER = 100
/** 신용카드 규격 — 전 세계가 같다 */
const CARD = { w: 85.6, h: 53.98 }

export function Calibrate({ onClose }: { onClose: () => void }) {
  const [cal, setCal] = useState(screenScale())
  /** 잰 값: 확대 배율(%) · 화면 눈금(mm) · 자로 잰 실제(mm) */
  const [zoom, setZoom] = useState('100')
  const [shown, setShown] = useState(String(RULER))
  const [real, setReal] = useState('')

  // 보이는 크기는 보정값을 즉시 반영한다 — 밀어보면서 맞추는 게 요점이다
  const mm = (v: number) => `${v * cssMmPx() * cal}px`
  const apply = (v: number) => {
    setCal(Math.min(3, Math.max(0.4, v)))
  }
  const save = () => {
    setScreenScale(cal)
    onClose()
  }

  /**
   * 잰 값 하나로 보정값을 낸다.
   *
   *   보정 = 지금 보정 × (화면 눈금 × 확대배율) / 자로 잰 실제
   *
   * 확대 배율을 받는 이유: **크게 확대한 판에서 재는 게 더 정확하다.**
   * 아래 100mm 막대에서 재면 배율은 100 그대로 두면 된다.
   *
   * 예) 확대 125%, 화면 눈금 9mm 가 자로 10mm → 1 × 9 × 1.25 / 10 = 1.125 (112.5%)
   */
  const fromMeasure = () => {
    const z = Number(zoom) / 100
    const s = Number(shown)
    const r = Number(real)
    if (![z, s, r].every((v) => Number.isFinite(v) && v > 0)) return
    apply(cal * ((s * z) / r))
    setReal('')
  }

  return (
    <div className="modal" onMouseDown={onClose}>
      <div className="sheetbox" onMouseDown={(e) => e.stopPropagation()}>
        <h3>화면 실물 크기 맞추기</h3>
        <p className="hint nopad">
          브라우저는 이 화면이 실제로 몇 인치인지 모릅니다 (1인치를 96px 로 «정해» 두고 씁니다).
          한 번 맞춰두면 <b>확대 100% 가 진짜 실물 크기</b>가 됩니다.
          <b> 인쇄 결과에는 영향이 없습니다</b> — 인쇄는 진짜 mm 로 나갑니다.
        </p>

        <h5>1. 자로 재기</h5>
        <div className="ruler" style={{ width: mm(RULER) }}>
          {Array.from({ length: RULER / 10 + 1 }, (_, i) => (
            <i key={i} className={i % 5 === 0 ? 'big' : ''} style={{ left: mm(i * 10) }}>
              {i % 5 === 0 && <b>{i * 10}</b>}
            </i>
          ))}
        </div>
        <p className="hint sm nopad">
          이 막대를 자로 재서 아래에 적으세요. <b>판의 눈금자에서 재도 됩니다</b> — 그때는 확대
          배율을 같이 적으면 됩니다. 크게 확대해서 잴수록 정확합니다.
        </p>
        <div className="cfree measure">
          <span>확대</span>
          <input type="number" step={5} value={zoom} onChange={(e) => setZoom(e.target.value)} />
          <span>% 에서 화면 눈금</span>
          <input type="number" step={0.5} value={shown} onChange={(e) => setShown(e.target.value)} />
          <span>mm 가 자로</span>
          <input
            type="number"
            step={0.5}
            value={real}
            placeholder="?"
            onChange={(e) => setReal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fromMeasure()}
          />
          <span>mm</span>
          <button onClick={fromMeasure} disabled={!real}>
            맞추기
          </button>
        </div>

        <h5>2. 카드로 맞추기</h5>
        <p className="hint sm nopad">
          신용카드·교통카드를 화면에 대고, 테두리가 딱 맞을 때까지 −/+ 를 누르세요.
        </p>
        <div className="cardbox" style={{ width: mm(CARD.w), height: mm(CARD.h) }}>
          <span>85.6 × 53.98 mm</span>
        </div>
        <div className="cfree">
          <button onClick={() => apply(cal - 0.005)}>−</button>
          <button onClick={() => apply(cal + 0.005)}>+</button>
          <span className="grow">1mm = {Math.round(cssMmPx() * cal * 100) / 100}px</span>
          <button onClick={() => apply(1)}>보정 없음</button>
        </div>

        <h5>3. 값을 알고 있다면</h5>
        <div className="cfree">
          <span>보정</span>
          {/* 이미 계산해둔 값이 있으면 바로 넣는 게 제일 빠르다 */}
          <input
            type="number"
            step={0.5}
            value={Math.round(cal * 1000) / 10}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (Number.isFinite(v) && v > 0) apply(v / 100)
            }}
          />
          <span>%</span>
          <span className="grow">
            100% 확대에서 63mm 카드가 화면에 {Math.round(63 * cal * 10) / 10}mm 로 그려집니다
          </span>
        </div>

        <div className="rowbtn">
          <button className="go" onClick={save}>
            적용
          </button>
          <button
            onClick={() => {
              resetScreenScale()
              onClose()
            }}
          >
            초기화
          </button>
          <button onClick={onClose}>취소</button>
        </div>
      </div>
    </div>
  )
}
