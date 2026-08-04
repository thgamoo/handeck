/**
 * 파일로 내려주기.
 *
 * [주의] **이걸 `png.ts` 에 두면 안 된다.** 거기엔 `react-dom/server` 가 딸려 있어서
 * (+75KB), 내려받기 한 줄을 쓰려고 그 파일을 부르는 순간 무거운 것이 주 번들로
 * 끌려온다. 실제로 그랬다 — 묶음 저장을 붙이자 번들이 219 -> 300KB 가 됐다.
 * 여러 곳이 쓰는 잔부품은 무거운 것과 같은 파일에 두지 않는다.
 */

export function downloadBlob(blob: Blob, name: string): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
