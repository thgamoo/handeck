/**
 * 눈금자 — 판의 가로·세로에 붙는다.
 *
 * 0 은 **카드의 왼쪽 위 모서리**다. 도련이 없으니 0 이 곧 재단선이고,
 * 눈금이 그대로 «카드 안에서 몇 mm» 를 뜻한다.
 *
 * 판 옆에 붙여 같이 움직이게 둔다 (화면 가장자리에 고정하지 않는다).
 * 확대하거나 스크롤해도 눈금과 판이 어긋날 일이 없다.
 */

interface Props {
  axis: 'x' | 'y'
  /** 판의 길이 (mm) */
  len: number
  /** 1mm 의 px (확대·화면 보정까지 반영된 값) */
  mmPx: number
  /** 마우스 자리 (mm). 판 밖이면 undefined */
  cursor?: number
  /** 고른 레이어가 차지하는 구간 (mm) */
  span?: { from: number; to: number }
}

/** 눈금이 너무 촘촘하면 읽을 수 없다. 확대 배율에 따라 간격을 고른다. */
function steps(mmPx: number): { tick: number; label: number } {
  const tick = mmPx >= 4 ? 1 : mmPx * 5 >= 4 ? 5 : 10
  const label = mmPx * 10 >= 26 ? 10 : mmPx * 50 >= 30 ? 50 : 100
  return { tick, label }
}

export function Ruler({ axis, len, mmPx, cursor, span }: Props) {
  const { tick, label } = steps(mmPx)
  const marks: number[] = []
  for (let v = 0; v <= len + 0.001; v += tick) marks.push(Math.round(v * 100) / 100)
  const at = (v: number) => (axis === 'x' ? { left: v * mmPx } : { top: v * mmPx })
  const size = (v: number) => (axis === 'x' ? { width: v * mmPx } : { height: v * mmPx })

  return (
    <div className={`ruler-bar ${axis}`} style={axis === 'x' ? { width: len * mmPx } : { height: len * mmPx }}>
      {/* 고른 레이어가 어디서 어디까지인지 — 자를 눈으로 훑지 않아도 된다 */}
      {span && (
        <span className="rspan" style={{ ...at(span.from), ...size(Math.max(0, span.to - span.from)) }} />
      )}
      {marks.map((v) => {
        const major = Math.abs(v % label) < 0.001
        const mid = !major && Math.abs(v % 5) < 0.001
        return (
          <i key={v} className={major ? 'major' : mid ? 'mid' : ''} style={at(v)}>
            {major && <b>{v}</b>}
          </i>
        )
      })}
      {cursor !== undefined && <span className="rcursor" style={at(cursor)} />}
    </div>
  )
}
