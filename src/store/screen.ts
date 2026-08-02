/**
 * 화면의 실물 크기 — «100% 가 진짜 63×88mm 인가».
 *
 * **브라우저의 `mm` 은 물리 단위가 아니다.** CSS 는 1인치를 무조건 96px 로 정해두고
 * 거기서 mm 를 역산한다 (1mm = 96/25.4 ≈ 3.78px). 실제 모니터가 인치당 120px 이면
 * 화면에 나온 «63mm» 는 자로 재면 50mm 밖에 안 된다. 화면 해상도·크기·OS 배율에
 * 따라 달라지므로 **프로그램이 알아낼 방법이 없다.** 사람이 한 번 재주는 수밖에 없다.
 *
 * 그래서 보정값을 하나 둔다. 한 번 맞춰두면 이 브라우저에서 계속 쓴다.
 *
 * ⚠️ **인쇄에는 영향을 주지 않는다.** 인쇄는 `@page` 와 mm 좌표로 나가고
 * 그건 진짜 물리 단위다 (`docs/print-findings.md` 실측). 여기서 고치는 건
 * **화면에 보이는 크기뿐**이다. 보정을 잘못해도 인쇄물은 멀쩡하다.
 */

const KEY = 'handeck:screen-cal'

/** 너무 어긋난 값이 들어가면 화면을 못 쓰게 된다 */
const MIN = 0.4
const MAX = 3

/**
 * 이 컴퓨터에서 **자로 재서 나온 값** (2026-08-02).
 *
 * 확대 125% 에서 화면 눈금 9mm 가 자로 10mm 였다 → `125 × 0.9 = 112.5%`.
 * 즉 보정 없이는 100% 가 실물의 0.889배로 그려지고 있었다.
 *
 * 다른 화면에서 열면 이 값이 안 맞을 수 있다. 그때는 머리말의 배율을 눌러
 * 다시 재면 된다 — 저장된 값이 있으면 그게 늘 우선한다.
 */
const MEASURED = 1.125

/**
 * 저장 형식 판. 올리면 예전에 저장된 보정값을 버리고 위 기본값부터 다시 시작한다.
 * (보정을 넣기 전에 «1.0» 으로 저장돼 버린 값이 기본값을 가리는 걸 막는다)
 */
const FORMAT = 2

let cal = read()
let version = 0
const listeners = new Set<() => void>()

function read(): number {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return MEASURED
    const saved = JSON.parse(raw) as { v?: number; cal?: number }
    if (saved?.v !== FORMAT) return MEASURED
    const v = Number(saved.cal)
    return Number.isFinite(v) && v >= MIN && v <= MAX ? v : MEASURED
  } catch {
    return MEASURED
  }
}

export const screenScale = (): number => cal
export const screenVersion = (): number => version

export function subscribeScreen(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function setScreenScale(v: number): void {
  const next = Math.min(MAX, Math.max(MIN, v))
  if (!Number.isFinite(next) || next === cal) return
  cal = next
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: FORMAT, cal: next }))
  } catch {
    // 저장 못 해도 이번 세션에서는 동작한다
  }
  version++
  for (const fn of listeners) fn()
}

/** 이 컴퓨터에서 잰 값으로 되돌린다 (보정 자체를 끄려면 창에서 «보정 없음») */
export function resetScreenScale(): void {
  setScreenScale(MEASURED)
}

/** 브라우저가 말하는 1mm 의 px. 화면이 바뀌지 않는 한 그대로라 한 번만 잰다. */
let cssMm = 0
export function cssMmPx(): number {
  if (cssMm) return cssMm
  const probe = document.createElement('div')
  probe.style.cssText = 'position:absolute;visibility:hidden;width:100mm'
  document.body.appendChild(probe)
  cssMm = probe.getBoundingClientRect().width / 100
  probe.remove()
  return cssMm
}

/** 보정까지 반영한 1mm 의 px. 화면에 mm 를 그릴 때는 늘 이걸 쓴다. */
export const mmPx = (): number => cssMmPx() * cal
