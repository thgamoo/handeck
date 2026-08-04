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

/**
 * 저장소를 연다.
 *
 * **[함정] 판 번호를 올리면 «다른 탭» 때문에 영영 안 열릴 수 있다.**
 * 예전 판으로 열어둔 탭이 하나라도 있으면 브라우저는 새 판으로 올리지 못하고
 * `blocked` 상태로 **가만히 멈춘다.** 그러면 이 약속이 영원히 안 끝나고,
 * 그림 읽기가 전부 그 자리에 걸려 **그림만 조용히 사라진 것처럼 보인다.**
 * 실제로 그렇게 됐다 (판 1 → 2 로 올리며 글꼴 저장소를 넣었을 때).
 *
 * 그래서 셋을 한다:
 *   1. `versionchange` — 다른 탭이 올리려 하면 **이 연결을 닫아준다.** 안 닫으면 그쪽이 멈춘다
 *   2. `blocked` — 멈추는 대신 **이유를 말하고 실패한다** (탭을 닫으라고)
 *   3. 실패하면 캐시를 비운다 — 안 그러면 한 번 실패한 약속이 계속 돌아온다
 */
function open(): Promise<IDBDatabase> {
  if (dbp) return dbp
  dbp = new Promise<IDBDatabase>((res, rej) => {
    const req = indexedDB.open(DB, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(FONT_STORE)) db.createObjectStore(FONT_STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => {
      const db = req.result
      db.onversionchange = () => {
        // 다른 탭이 새 판을 올리려 한다. 붙잡고 있으면 그쪽이 멈춘다.
        db.close()
        dbp = null
      }
      db.onclose = () => {
        dbp = null
      }
      res(db)
    }
    req.onerror = () => {
      dbp = null
      rej(req.error ?? new Error('저장소를 열지 못했습니다'))
    }
    req.onblocked = () => {
      dbp = null
      rej(
        new Error(
          '다른 탭에서 handeck 이 열려 있어 저장소를 열지 못했습니다. 그 탭을 닫고 새로고침하세요.'
        )
      )
    }
  }).catch((e) => {
    dbp = null
    throw e
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
        // [주의] 쓰기는 **요청 성공이 아니라 트랜잭션 완료**를 기다려야 한다.
        // 요청이 성공해도 커밋 전에 새로고침하면 그 쓰기는 없던 일이 된다 —
        // «그림을 넣고 바로 새로고침하면 사라진다» 가 정확히 이것이다.
        if (mode === 'readwrite') {
          t.oncomplete = () => res(req.result)
          t.onabort = () => rej(t.error ?? new Error('저장이 취소됐습니다'))
          t.onerror = () => rej(t.error ?? req.error)
        } else {
          req.onsuccess = () => res(req.result)
          req.onerror = () => rej(req.error)
        }
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

/** 묶어 내보낼 때 — 파일과 함께 원래 이름·형식도 필요하다 */
export async function getAssetFile(id: string): Promise<{ meta: AssetMeta; blob: Blob } | undefined> {
  const rec = await tx<AssetRecord | undefined>('readonly', (s) => s.get(id))
  return rec ? { meta: stripBlob(rec), blob: rec.blob } : undefined
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

/**
 * 저장소를 못 쓸 때의 이유. 있으면 화면에 띄운다.
 *
 * 예전에는 여기서 실패하면 **그림만 조용히 안 보였다.** 사용자는 그림이
 * 날아간 줄 알지 저장소가 안 열린 줄은 알 수 없다.
 */
let trouble: string | null = null
export const assetTrouble = (): string | null => trouble

/**
 * 마지막 `warmUrls` 에서 **몇 개를 찾았고 몇 개가 없었는지.**
 *
 * 그림이 안 보일 때 원인이 셋인데 화면만 봐서는 구분이 안 된다:
 *   ① 저장소가 안 열림  ② 저장소는 열렸는데 그 그림이 없음  ③ 프로젝트가 그림을 안 가리킴
 * 숫자로 보여주면 한눈에 갈린다.
 */
let tally = { want: 0, have: 0 }
export const assetTally = (): { want: number; have: number } => tally

/**
 * 저장소를 **지워지지 않게** 해달라고 브라우저에 요청한다.
 *
 * 안 하면 IndexedDB 는 «지워도 되는» 취급이라 저장 공간이 빠듯할 때 통째로 비워질 수 있다.
 * 그러면 프로젝트(localStorage)는 남고 **그림만 사라진다** — 겪은 증상과 정확히 같은 모양이다.
 */
export async function keepStorage(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist()
    }
  } catch {
    // 못 해도 그냥 쓴다
  }
}

/** 프로젝트가 쓰는 에셋들의 URL 을 미리 만들어 둔다. */
export async function warmUrls(ids: Iterable<string>): Promise<void> {
  let added = false
  let want = 0
  let have = 0
  try {
    for (const id of ids) {
      if (!id) continue
      want++
      if (urls.has(id)) {
        have++
        continue
      }
      const blob = await getBlob(id)
      if (blob) {
        urls.set(id, URL.createObjectURL(blob))
        have++
        added = true
      }
    }
    if (trouble) {
      trouble = null
      added = true
    }
  } catch (e) {
    trouble = e instanceof Error ? e.message : '그림 저장소를 읽지 못했습니다'
    added = true
  }
  if (tally.want !== want || tally.have !== have) {
    tally = { want, have }
    added = true
  }
  if (added) notify()
}
