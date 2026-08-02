/**
 * 자동 저장.
 *
 * 서버가 없으므로 새로고침 한 번에 작업이 날아가면 안 된다.
 * 프로젝트(JSON)는 localStorage 에, 이미지는 이미 IndexedDB 에 있다.
 *
 * 나중에 File System Access API 로 «실제 파일에 저장» 을 붙여도
 * 이 자동 저장은 그대로 둔다. 사고 방지용 안전망이다.
 */

import type { Project } from '../core/model.ts'

const KEY = 'handeck:project'

/**
 * 예전 저장본 손보기.
 *
 * 도련이 **조각의 속성**이던 시절의 파일이 있다 (`size.bleed`).
 * 도련은 자를 때 생기는 것이라 인쇄물(시트)로 옮겼다. 열 때 값을 넘겨주고
 * 조각에서는 지운다 — 안 그러면 예전 파일이 도련을 잃는다.
 *
 * 받은 객체를 그대로 고친다. 저장할 땐 이미 새 형식이므로 한 번만 지나간다.
 */
export function migrate(p: Project): Project {
  type Legacy = { bleed?: number }
  let carried = 0
  for (const c of Object.values(p.components ?? {})) {
    const legacy = c.size as typeof c.size & Legacy
    if (typeof legacy.bleed === 'number') {
      carried = Math.max(carried, legacy.bleed)
      delete legacy.bleed
    }
  }
  for (const d of p.decks ?? []) {
    if (!d.sheet) continue
    if (d.sheet.bleed === undefined && carried > 0) d.sheet.bleed = carried
    // 예전 `each` 는 그대로 두고, `none` 이던 것도 그대로 둔다.
    // 도련을 켤지는 이제 인쇄할 때 고르는 것이라 마음대로 켜주지 않는다.
  }
  return p
}

export function saveLocal(p: Project): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch (err) {
    // 용량 초과 등. 이미지는 IndexedDB 에 있으므로 보통 여기까지 안 온다.
    console.warn('자동 저장 실패:', err)
  }
}

export function loadLocal(): Project | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Project
    if (p?.handeck !== 1 || !p.components || !p.decks) return null
    return migrate(p)
  } catch {
    return null
  }
}

/** 파일로 내보내기 — 공유·백업용 */
export function downloadProject(p: Project): void {
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${p.name || 'project'}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
