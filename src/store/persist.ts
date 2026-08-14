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
  // 보드가 없던 시절의 파일. 빈 목록으로 채워 «있는데 비어 있음» 으로 만든다 —
  // 읽는 쪽마다 `?? []` 를 적지 않아도 되게.
  if (!Array.isArray(p.boards)) p.boards = []
  // 룰북이 없던 시절의 파일. 같은 이유로 빈 목록을 채워둔다.
  if (!Array.isArray(p.rulebooks)) p.rulebooks = []
  // 쪽은 «한 장씩» 이 전제다. 손으로 고친 파일에서 `qty` 가 빠졌거나 0 이면
  // 조판이 그 쪽을 통째로 건너뛴다 — 그건 «쪽이 사라졌다» 로 보인다.
  for (const b of p.rulebooks ?? []) for (const pg of b.pages ?? []) if (!pg.qty) pg.qty = 1

  // **뒷면은 있는데 `duplex` 가 꺼진 덱** — 조용히 단면으로 나간다.
  // 조판은 `anyBack && duplex` 일 때만 뒷면 쪽을 만드는데(`impose.ts`),
  // 속성 패널의 «넘김» 은 `false` 를 «긴 쪽» 으로 **표시만** 해서
  // 화면에는 양면이라고 적혀 있고 인쇄는 단면인 상태가 된다.
  // UI 로 뒷면을 붙이면 `duplex` 도 같이 켜지므로, 이 상태는 덱 JSON 을
  // 가져왔을 때만 생긴다. 표시된 대로 맞춰준다.
  for (const d of p.decks ?? []) if (d.back && !d.duplex) d.duplex = 'long'
  return p
}

/** 마지막으로 저장한 내용. 창이 닫힐 때 이걸 즉시 밀어 넣는다. */
let latest: Project | null = null

export function saveLocal(p: Project): void {
  latest = p
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch (err) {
    // 용량 초과 등. 이미지는 IndexedDB 에 있으므로 보통 여기까지 안 온다.
    console.warn('자동 저장 실패:', err)
  }
}

/** 아직 저장 안 된 게 있으면 지금 저장한다 */
export function flushLocal(p: Project): void {
  if (latest === p) return
  saveLocal(p)
}

/**
 * 창이 닫히거나 숨을 때 **밀린 저장을 끝낸다.**
 *
 * 자동 저장은 0.4초 미뤄서 한다 (타이핑마다 쓰면 느리다). 그런데 그 0.4초 안에
 * 새로고침하면 **마지막 편집이 통째로 날아간다.** «간헐적으로 글자가 사라진다» 가
 * 정확히 이것이었다 — 고치고 바로 새로고침했느냐 아니냐의 차이다.
 *
 * `beforeunload` 만으로는 모자란다. 모바일·탭 전환에서는 안 오는 경우가 있어
 * `pagehide` 와 «숨김» 상태 전환도 같이 듣는다.
 */
export function watchUnload(get: () => Project): () => void {
  const flush = () => flushLocal(get())
  const onHide = () => {
    if (document.visibilityState === 'hidden') flush()
  }
  window.addEventListener('beforeunload', flush)
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', onHide)
  return () => {
    window.removeEventListener('beforeunload', flush)
    window.removeEventListener('pagehide', flush)
    document.removeEventListener('visibilitychange', onHide)
  }
}

/**
 * 불러오다 실패했으면 그 이유. **있으면 자동 저장을 멈춰야 한다.**
 *
 * 예전에는 못 읽으면 조용히 `null` 을 돌려줬고, 그러면 화면에는 **예제**가 뜬 채로
 * 자동 저장이 0.4초 뒤에 **그 예제로 저장된 작업을 덮어썼다.** 못 읽은 것뿐인데
 * 원본까지 없애버리는 셈이다. 그래서 실패를 밖으로 알린다.
 */
let loadError: string | null = null
export const loadFailed = (): string | null => loadError

export function loadLocal(): Project | null {
  loadError = null
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch (e) {
    loadError = '이 브라우저에서 저장소를 쓸 수 없습니다'
    return null
  }
  if (!raw) return null // 처음 켠 것 — 실패가 아니다

  try {
    const p = JSON.parse(raw) as Project
    if (p?.handeck !== 1 || !p.components || !p.decks) throw new Error('형식이 아닙니다')
    return migrate(p)
  } catch (e) {
    // 못 읽은 내용을 **따로 치워둔다.** 덮어써서 영영 잃는 것보다 낫다.
    try {
      localStorage.setItem(`${KEY}:broken`, raw)
    } catch {
      // 치워둘 자리도 없으면 어쩔 수 없다
    }
    loadError = `저장된 작업을 읽지 못했습니다 (${e instanceof Error ? e.message : e}). ` +
      `덮어쓰지 않도록 자동 저장을 멈췄습니다 — 원본은 handeck:project:broken 에 남겨뒀습니다.`
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
