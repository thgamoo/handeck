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
  /**
   * 굵게를 **흉내내도 되는가**. 없으면 흉내낸다(true).
   *
   * 글꼴 파일 하나에는 보통 굵기가 하나뿐이다 (Medium 이면 Medium 만). 그 파일을
   * «모든 굵기» 로 등록하면 굵기를 700으로 올려도 화면이 안 변한다.
   * 흉내를 허용하면 브라우저가 획을 부풀려 굵게 만들어준다 — 진짜 Bold 만은 못해도
   * 파일 하나로 굵기 차이를 낼 수 있다.
   *
   * Regular·Bold 파일을 **따로 넣었다면 꺼야 한다.** 안 그러면 Bold 파일에 흉내가
   * 또 얹혀 뭉개진다.
   */
  synth?: boolean
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
  synth: r.synth !== false,
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
 * **`weight` 를 뭐라고 적느냐가 굵기 조절을 켜고 끈다.**
 *
 *   `'400'`     — 이 파일은 «보통 굵기» 라고 알린다. 700을 달라고 하면 브라우저가
 *                 **획을 부풀려 굵게 만든다**(합성). 파일이 하나뿐일 때 이게 필요하다
 *   `'100 900'` — 이 파일이 «모든 굵기» 라고 알린다. 그러면 합성이 일어나지 않아
 *                 굵기를 올려도 화면이 안 변한다. 진짜 Bold 파일을 따로 넣었을 때 맞다
 *
 * 처음엔 후자로 두었는데, 굵기 하나짜리 글꼴을 넣으면 «굵기 조절이 안 되는» 것처럼
 * 보였다. 그래서 **기본을 합성 허용으로 바꾸고** 끌 수 있게 했다.
 */
/**
 * `@font-face` 에 적을 굵기.
 *
 * **화면(`install`)과 PNG(`fontFaceCss`)가 반드시 같은 값을 써야 한다.**
 * 한쪽만 `100 900` 이면 그쪽에서만 합성이 꺼져 «화면은 굵은데 PNG 는 얇다» 가 된다.
 * 실제로 그렇게 갈라진 적이 있어서 함수로 묶어둔다.
 */
export const faceWeight = (rec: { synth?: boolean }): string => (rec.synth === false ? '100 900' : '400')

async function install(rec: FontRecord): Promise<void> {
  const old = installed.get(rec.id)
  if (old) {
    document.fonts.delete(old)
    installed.delete(rec.id)
  }
  const face = new FontFace(rec.family, await rec.blob.arrayBuffer(), {
    weight: faceWeight(rec),
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

/** 묶어 내보낼 때 — 파일과 함께 이름·형식도 필요하다 */
export async function getFontFile(id: string): Promise<{ meta: FontMeta; blob: Blob } | undefined> {
  const rec = await dbTx<FontRecord | undefined>(FONT_STORE, 'readonly', (s) => s.get(id))
  return rec ? { meta: strip(rec), blob: rec.blob } : undefined
}

/**
 * 파일 하나를 들여온다. 같은 파일이면 있던 걸 그대로 쓴다.
 *
 * `family` 를 주면 그 이름으로 쓰려 한다 (묶음에서 들여올 때). 다만 **이미 다른
 * 글꼴이 그 이름을 쓰고 있으면 번호를 붙여 피한다** — 그래서 실제로 정해진 이름을
 * 돌려준다. 부르는 쪽이 그 이름으로 프로젝트를 고쳐야 한다.
 */
export async function importFont(file: File, family?: string): Promise<FontMeta> {
  const id = await hashBlob(file)
  const existing = await dbTx<FontRecord | undefined>(FONT_STORE, 'readonly', (s) => s.get(id))
  if (existing) {
    if (!installed.has(id)) await install(existing)
    return strip(existing)
  }

  const rec: FontRecord = {
    id,
    family: uniqueFamily(family?.trim() || familyFromName(file.name)),
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

/** 굵게 흉내를 켜고 끈다. 켜면 굵기 조절이 먹고, 끄면 파일 그대로 나온다. */
export async function setFontSynth(id: string, synth: boolean): Promise<void> {
  const rec = await dbTx<FontRecord | undefined>(FONT_STORE, 'readonly', (s) => s.get(id))
  if (!rec) return
  const updated: FontRecord = { ...rec, synth }
  await install(updated)
  await dbTx(FONT_STORE, 'readwrite', (s) => s.put(updated))
  metas = metas.map((m) => (m.id === id ? strip(updated) : m))
  notify()
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
    // [주의] 굵기 선언을 **화면과 똑같이** 적어야 한다. 여기 `100 900` 을 박아두면
    // SVG 안에서는 합성이 꺼져서, 화면에선 굵던 글자·칩이 **PNG 에서만 얇게** 나온다.
    // 인쇄는 이 함수를 안 쓰고 살아 있는 문서를 그대로 쓰므로 멀쩡했다 —
    // 그래서 «PNG 만 다르다» 로 보였다. (`install()` 의 같은 규칙과 짝을 맞춘다)
    const weight = faceWeight(rec)
    out.push(
      `@font-face{font-family:"${m.family}";src:url(${url});font-weight:${weight};font-style:normal;}`
    )
  }
  return out.join('\n')
}
