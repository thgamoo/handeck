/**
 * 이미지 저장소 — IndexedDB.
 *
 * 브라우저 안에서 도는 앱이라 이미지를 파일 경로로 들 수 없다.
 * 업로드한 blob 을 **내용 해시**로 키를 만들어 넣는다.
 *   - 같은 그림을 여러 번 올려도 한 번만 저장된다
 *   - project.json 은 id 만 참조하므로 가볍게 유지된다
 *   - 공유할 때 쓰인 id 만 모아 묶으면 된다
 */

const DB = 'handeck'
/** 2 에서 글꼴 저장소가 생겼다. 올릴 때 기존 이미지는 그대로 둔다. */
const VERSION = 2
const STORE = 'assets'
export const FONT_STORE = 'fonts'

export interface AssetMeta {
  id: string
  name: string
  type: string
  size: number
  width: number
  height: number
}

interface AssetRecord extends AssetMeta {
  blob: Blob
}

let dbp: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp
  dbp = new Promise((res, rej) => {
    const req = indexedDB.open(DB, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(FONT_STORE)) db.createObjectStore(FONT_STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
  return dbp
}

/** 아무 저장소나 쓰는 트랜잭션. 글꼴 저장소(`fonts.ts`)도 이걸 쓴다. */
export function dbTx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((res, rej) => {
        const t = db.transaction(store, mode)
        const req = fn(t.objectStore(store))
        req.onsuccess = () => res(req.result)
        req.onerror = () => rej(req.error)
      })
  )
}

const tx = <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
  dbTx(STORE, mode, fn)

/** 내용 해시 — 같은 파일을 여러 번 넣어도 한 번만 저장된다. 글꼴도 같은 규칙을 쓴다. */
export async function hashBlob(blob: Blob): Promise<string> {
  return hash(blob)
}

async function hash(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function measure(blob: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error('이미지를 읽지 못했습니다'))
      img.src = url
    })
    return { width: img.naturalWidth, height: img.naturalHeight }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * 화면에서 쓸 URL 캐시.
 *
 * [주의] 그냥 Map 으로 두면 React 가 «URL 이 생겼다» 는 걸 모른다.
 * 렌더 중에 아직 없던 URL 이 나중에 채워져도 다시 그리지 않아
 * «업로드했는데 반영이 안 되는» 것처럼 보인다.
 * 그래서 구독자를 두고 채워질 때마다 알린다.
 */
const urls = new Map<string, string>()
const listeners = new Set<() => void>()
let version = 0

export function subscribeAssets(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const assetsVersion = (): number => version

function notify(): void {
  version++
  for (const fn of listeners) fn()
}

export async function putAsset(file: File | Blob, name?: string): Promise<AssetMeta> {
  const id = await hash(file)
  const existing = await tx<AssetRecord | undefined>('readonly', (s) => s.get(id))
  if (existing) return stripBlob(existing)

  const { width, height } = await measure(file)
  const rec: AssetRecord = {
    id,
    name: name ?? (file instanceof File ? file.name : `${id}.png`),
    type: file.type || 'image/png',
    size: file.size,
    width,
    height,
    blob: file,
  }
  await tx('readwrite', (s) => s.put(rec))
  return stripBlob(rec)
}

const stripBlob = (r: AssetRecord): AssetMeta => ({
  id: r.id,
  name: r.name,
  type: r.type,
  size: r.size,
  width: r.width,
  height: r.height,
})

export async function getBlob(id: string): Promise<Blob | undefined> {
  const rec = await tx<AssetRecord | undefined>('readonly', (s) => s.get(id))
  return rec?.blob
}

/** 렌더에 쓸 URL. 한 번 만들면 캐시한다. */
export function assetUrl(id: string): string | undefined {
  return urls.get(id)
}

/**
 * 내보내기용 — 그림을 `data:` URL 로.
 *
 * 화면에서 쓰는 `blob:` URL 은 **SVG 안에서 안 읽힌다.** 그런데 에러가 나는 게
 * 아니라 그냥 빈 칸으로 나와서, 안 바꾸면 «그림만 빠진 PNG» 를 얻게 된다.
 */
export async function assetDataUrls(ids: Iterable<string>): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const id of ids) {
    if (!id || out.has(id)) continue
    const blob = await getBlob(id)
    if (!blob) continue
    out.set(
      id,
      await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(String(r.result))
        r.onerror = () => rej(r.error)
        r.readAsDataURL(blob)
      })
    )
  }
  return out
}

/** 프로젝트가 쓰는 에셋들의 URL 을 미리 만들어 둔다. */
export async function warmUrls(ids: Iterable<string>): Promise<void> {
  let added = false
  for (const id of ids) {
    if (!id || urls.has(id)) continue
    const blob = await getBlob(id)
    if (blob) {
      urls.set(id, URL.createObjectURL(blob))
      added = true
    }
  }
  if (added) notify()
}
