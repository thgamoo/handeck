/**
 * 글꼴 — 사용자가 직접 넣는다.
 *
 * 서버가 없으므로 글꼴도 그림과 같은 자리에 산다: **파일은 IndexedDB**,
 * `project.json` 에는 **어떤 글꼴을 쓰는지만** 적힌다. 그래야 프로젝트 파일이
 * 가볍고, 같은 글꼴을 여러 프로젝트가 나눠 쓴다.
 *
 * 화면에 다는 방법은 `FontFace` API 다. `@font-face` 규칙을 문자열로 만들어
 * 붙이는 것보다 낫다 — 파일을 URL 로 노출하지 않아도 되고, 다 읽혔는지를
 * `document.fonts.ready` 로 정확히 알 수 있다 (인쇄 직전에 이게 필요하다).
 *
 * **인쇄도 같은 문서에서 일어나므로 여기 등록된 글꼴이 그대로 PDF 에 박힌다.**
 * 별도의 글꼴 내장 처리가 필요 없다.
 */

import { dbTx, FONT_STORE, hashBlob } from './assets.ts'

export interface FontMeta {
  /** 내용 해시 */
  id: string
  /** CSS 에서 쓸 이름. 파일 이름에서 따오고 사용자가 고칠 수 있다. */
  family: string
  /** 원래 파일 이름 */
  name: string
  type: string
  size: number
}

interface FontRecord extends FontMeta {
  blob: Blob
}

const strip = (r: FontRecord): FontMeta => ({
  id: r.id,
  family: r.family,
  name: r.name,
  type: r.type,
  size: r.size,
})

// ---------------------------------------------------------------------------
// 구독 — 그림(assets.ts)과 같은 이유다. 글꼴이 늦게 붙어도 화면이 다시 그려져야 한다.

let metas: FontMeta[] = []
let version = 0
const listeners = new Set<() => void>()
const installed = new Map<string, FontFace>()

export const fonts = (): FontMeta[] => metas
export const fontsVersion = (): number => version
export function subscribeFonts(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function notify(): void {
  version++
  for (const fn of listeners) fn()
}

// ---------------------------------------------------------------------------

/** 파일 이름에서 글꼴 이름을 만든다. `Pretendard-Bold.ttf` -> `Pretendard-Bold` */
function familyFromName(name: string): string {
  return name.replace(/\.(ttf|otf|woff2?|ttc)$/i, '').trim() || '새 글꼴'
}

/** 이미 쓰고 있는 이름이면 뒤에 번호를 붙인다 (다른 파일인데 이름이 같으면 골라 쓸 수가 없다) */
function uniqueFamily(want: string, exceptId?: string): string {
  const taken = new Set(metas.filter((m) => m.id !== exceptId).map((m) => m.family))
  if (!taken.has(want)) return want
  for (let i = 2; ; i++) if (!taken.has(`${want} ${i}`)) return `${want} ${i}`
}

/**
 * 브라우저에 실제로 단다.
 *
 * `weight: '100 900'` 인 것이 중요하다. 굵기 하나짜리 글꼴을 `400` 으로 못 박으면
 * 굵게(700)를 줬을 때 브라우저가 **획을 억지로 부풀려 가짜 굵게**를 만든다.
 * 범위로 선언하면 그 글꼴을 모든 굵기에 그대로 쓴다 — 인쇄물에서 이게 훨씬 깨끗하다.
 * 진짜 굵은 글꼴이 필요하면 Bold 파일을 따로 불러오면 된다.
 */
async function install(rec: FontRecord): Promise<void> {
  const old = installed.get(rec.id)
  if (old) {
    document.fonts.delete(old)
    installed.delete(rec.id)
  }
  const face = new FontFace(rec.family, await rec.blob.arrayBuffer(), {
    weight: '100 900',
    style: 'normal',
    display: 'block', // 글꼴이 늦게 오면 대체 글꼴로 잠깐 보였다가 바뀌는 게 더 헷갈린다
  })
  await face.load()
  document.fonts.add(face)
  installed.set(rec.id, face)
}

/** 시작할 때 한 번. 저장돼 있던 글꼴을 전부 단다. */
export async function loadFonts(): Promise<void> {
  const all = await dbTx<FontRecord[]>(FONT_STORE, 'readonly', (s) => s.getAll())
  metas = all.map(strip).sort((a, b) => a.family.localeCompare(b.family))
  for (const rec of all) {
    try {
      await install(rec)
    } catch (err) {
      // 깨진 파일 하나 때문에 나머지가 다 안 붙으면 안 된다
      console.warn(`글꼴을 달지 못했습니다: ${rec.name}`, err)
    }
  }
  notify()
}

/** 파일 하나를 들여온다. 같은 파일이면 있던 걸 그대로 쓴다. */
export async function importFont(file: File): Promise<FontMeta> {
  const id = await hashBlob(file)
  const existing = await dbTx<FontRecord | undefined>(FONT_STORE, 'readonly', (s) => s.get(id))
  if (existing) {
    if (!installed.has(id)) await install(existing)
    return strip(existing)
  }

  const rec: FontRecord = {
    id,
    family: uniqueFamily(familyFromName(file.name)),
    name: file.name,
    type: file.type || 'font/ttf',
    size: file.size,
    blob: file,
  }
  // 브라우저가 읽을 수 있는 파일인지 **먼저** 확인한다. 못 읽는 걸 저장해두면
  // 다음에 열 때마다 실패한다.
  await install(rec)
  await dbTx(FONT_STORE, 'readwrite', (s) => s.put(rec))
  metas = [...metas, strip(rec)].sort((a, b) => a.family.localeCompare(b.family))
  notify()
  return strip(rec)
}

/** 글꼴 이름 바꾸기 — 글자 레이어는 이름으로 글꼴을 가리키므로 쓰던 곳도 같이 고쳐야 한다. */
export async function renameFont(id: string, family: string): Promise<string | null> {
  const rec = await dbTx<FontRecord | undefined>(FONT_STORE, 'readonly', (s) => s.get(id))
  if (!rec) return null
  const next = uniqueFamily(family.trim() || familyFromName(rec.name), id)
  const updated: FontRecord = { ...rec, family: next }
  await install(updated)
  await dbTx(FONT_STORE, 'readwrite', (s) => s.put(updated))
  metas = metas.map((m) => (m.id === id ? strip(updated) : m)).sort((a, b) => a.family.localeCompare(b.family))
  notify()
  return next
}

export async function removeFont(id: string): Promise<void> {
  const face = installed.get(id)
  if (face) {
    document.fonts.delete(face)
    installed.delete(id)
  }
  await dbTx(FONT_STORE, 'readwrite', (s) => s.delete(id))
  metas = metas.filter((m) => m.id !== id)
  notify()
}

/** 이 브라우저에 있는 글꼴인가 (프로젝트가 쓰는데 없을 수 있다) */
export const hasFont = (id: string): boolean => metas.some((m) => m.id === id)

const dataUrl = (blob: Blob): Promise<string> =>
  new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(r.error)
    r.readAsDataURL(blob)
  })

/**
 * PNG 로 내보낼 때 쓸 `@font-face` 규칙.
 *
 * 내보내기는 SVG 안에서 그려지는데, 거기서는 `document.fonts` 에 등록해둔 글꼴이
 * **안 보인다.** 파일을 통째로 base64 로 심어야 불러온 글꼴 그대로 나온다.
 * 안 그러면 조용히 대체 글꼴로 바뀌어 «내보낸 것만 다르게 생긴» 결과가 된다.
 */
export async function fontFaceCss(families: Iterable<string>): Promise<string> {
  const want = new Set([...families].map((f) => f.trim()).filter(Boolean))
  if (want.size === 0) return ''
  const out: string[] = []
  for (const m of metas) {
    if (!want.has(m.family)) continue
    const rec = await dbTx<FontRecord | undefined>(FONT_STORE, 'readonly', (s) => s.get(m.id))
    if (!rec) continue
    const url = await dataUrl(rec.blob)
    out.push(
      `@font-face{font-family:"${m.family}";src:url(${url});font-weight:100 900;font-style:normal;}`
    )
  }
  return out.join('\n')
}
