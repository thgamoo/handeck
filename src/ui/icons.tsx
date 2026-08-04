/**
 * 아이콘 — 직접 그린 SVG.
 *
 * **아이콘 라이브러리를 넣지 않는 이유**: react-icons 같은 것이 주는 것도 결국
 * `<svg>` 안의 path 몇 줄이다. 우리가 쓰는 아이콘은 손에 꼽고, 의존성 셋
 * (react·react-dom·zustand)을 지키는 게 이 프로젝트의 성격이다.
 *
 * **이모지 대신 SVG 인 이유**: 이모지는 색을 못 바꾼다. 묶음마다 색이 달라야 하는데
 * 이모지 뒤에 색 칩을 깔아봐도 잘 안 보였다. `stroke="currentColor"` 로 두면
 * **글자색이 곧 아이콘 색**이라 부르는 쪽에서 `color` 하나만 주면 된다.
 */

/** 아이콘 함수의 모양 — 목록에 담아 돌릴 때 쓴다 */
export type IconFn = (p: IconProps) => JSX.Element

export interface IconProps {
  size?: number
  /** 획 굵기. 작게 그릴수록 굵어야 보인다 */
  weight?: number
  className?: string
  title?: string
}

/**
 * 정렬 아이콘 — 글줄 세 개를 어디에 붙이느냐로 나타낸다.
 *
 * 글자 길이가 제각각인 걸 보여줘야 «어디에 붙는지» 가 읽힌다. 세 줄을 전부
 * 같은 길이로 그리면 왼쪽·가운데·오른쪽이 구분되지 않는다.
 */
function Lines({ at, size = 14 }: { at: 'left' | 'center' | 'right' } & IconProps) {
  // [줄 길이] — 짧은 줄이 있어야 붙는 쪽이 보인다
  const runs = [16, 10, 13]
  const x = (w: number) => (at === 'left' ? 4 : at === 'right' ? 20 - w : 12 - w / 2)
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
      {runs.map((w, i) => (
        <line key={i} x1={x(w)} y1={7 + i * 5} x2={x(w) + w} y2={7 + i * 5} />
      ))}
    </svg>
  )
}

export const AlignLeft = (p: IconProps) => <Lines at="left" {...p} />
export const AlignCenter = (p: IconProps) => <Lines at="center" {...p} />
export const AlignRight = (p: IconProps) => <Lines at="right" {...p} />

/**
 * 세로 정렬 — **기준선 + 글덩이**로 나타낸다.
 *
 * 가로 정렬과 같은 «세 줄» 로 그리면 두 묶음이 구분되지 않는다.
 * 상자 안에서 글이 위/가운데/아래에 앉는 모습을 그대로 그린다.
 */
function VBox({ at, size = 14 }: { at: 'top' | 'middle' | 'bottom' } & IconProps) {
  const y = at === 'top' ? 4 : at === 'bottom' ? 20 : 12
  const boxY = at === 'top' ? 7 : at === 'bottom' ? 11 : 9
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
      <line x1={3} y1={y} x2={21} y2={y} />
      <rect x={7} y={boxY} width={10} height={6} rx={1} fill="none" />
    </svg>
  )
}

export const AlignTop = (p: IconProps) => <VBox at="top" {...p} />
export const AlignMiddle = (p: IconProps) => <VBox at="middle" {...p} />
export const AlignBottom = (p: IconProps) => <VBox at="bottom" {...p} />

/** 프린터 — 프린트묶기 표시 */
export function Printer({ size = 13, weight = 2, className, title }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {/* 위로 나온 종이 */}
      <path d="M7 8V3h10v5" />
      {/* 본체 */}
      <path d="M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
      {/* 나온 인쇄물 */}
      <path d="M7 14h10v7H7z" />
    </svg>
  )
}
