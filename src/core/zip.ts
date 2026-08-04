/**
 * ZIP — 압축 없이 «저장(stored)» 만.
 *
 * 묶음 파일(`.handeck`)을 만들고 읽는 데만 쓴다. 라이브러리를 들이지 않는 이유:
 *
 *   - 넣을 것이 **이미 압축된 것들**이다 (PNG·JPEG·woff2). 다시 압축해도
 *     몇 %도 안 줄고 시간만 든다. 그래서 압축기가 필요 없다
 *   - 그러면 남는 건 헤더 몇 개를 바이트로 쓰는 일뿐이라 백 줄이면 된다
 *   - 의존성 셋(react·react-dom·zustand)을 지키는 게 이 프로젝트의 성격이다
 *
 * 만든 파일은 **보통의 zip 이다** — 압축 프로그램으로 열어 그림을 꺼낼 수 있다.
 * 반대로 우리가 읽을 때는 압축된 항목을 만나면 거절한다 (그럴 일이 없다).
 */

export interface ZipEntry {
  name: string
  data: Uint8Array<ArrayBuffer>
}

// ---------------------------------------------------------------------------

let table: Uint32Array | null = null
function crcTable(): Uint32Array {
  if (table) return table
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  table = t
  return t
}

export function crc32(data: Uint8Array): number {
  const t = crcTable()
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const utf8 = new TextEncoder()

/** UTF-8 이름을 쓴다고 알리는 표시. 없으면 한글 파일 이름이 깨진다. */
const FLAG_UTF8 = 0x800
/** 압축 안 함 */
const STORED = 0

// ---------------------------------------------------------------------------

/**
 * 항목들을 zip 한 덩어리로.
 *
 * 시간은 **0(1980-01-01)으로 고정**한다. 만든 시각을 넣으면 같은 내용을 두 번
 * 내보내도 파일이 달라져서, 바뀐 게 있는지 비교할 수가 없다.
 */
export function zipBytes(entries: ZipEntry[]): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array<ArrayBuffer>[] = []
  const central: Uint8Array<ArrayBuffer>[] = []
  let offset = 0

  for (const e of entries) {
    const name = utf8.encode(e.name)
    const crc = crc32(e.data)

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true) // 로컬 헤더 표시
    lv.setUint16(4, 20, true) // 필요한 버전
    lv.setUint16(6, FLAG_UTF8, true)
    lv.setUint16(8, STORED, true)
    lv.setUint16(10, 0, true) // 시각
    lv.setUint16(12, 0, true) // 날짜
    lv.setUint32(14, crc, true)
    lv.setUint32(18, e.data.length, true) // 압축 후 크기 = 원본 크기
    lv.setUint32(22, e.data.length, true)
    lv.setUint16(26, name.length, true)
    lv.setUint16(28, 0, true) // 여분 없음
    local.set(name, 30)

    const cd = new Uint8Array(46 + name.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true) // 중앙 디렉터리 표시
    cv.setUint16(4, 20, true) // 만든 버전
    cv.setUint16(6, 20, true) // 필요한 버전
    cv.setUint16(8, FLAG_UTF8, true)
    cv.setUint16(10, STORED, true)
    cv.setUint16(12, 0, true)
    cv.setUint16(14, 0, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, e.data.length, true)
    cv.setUint32(24, e.data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint16(30, 0, true) // 여분
    cv.setUint16(32, 0, true) // 설명
    cv.setUint16(34, 0, true) // 디스크 번호
    cv.setUint16(36, 0, true) // 내부 속성
    cv.setUint32(38, 0, true) // 외부 속성
    cv.setUint32(42, offset, true) // 로컬 헤더 위치
    cd.set(name, 46)

    parts.push(local, e.data)
    central.push(cd)
    offset += local.length + e.data.length
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true) // 끝 표시
  ev.setUint16(4, 0, true)
  ev.setUint16(6, 0, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)
  ev.setUint16(20, 0, true)

  const all = [...parts, ...central, end]
  const out = new Uint8Array(all.reduce((n, u) => n + u.length, 0))
  let at = 0
  for (const u of all) {
    out.set(u, at)
    at += u.length
  }
  return out
}

/** 바이트를 만드는 것과 파일로 감싸는 것을 나눠둔다 — 바이트 쪽은 확인하기 쉽다 */
export const zip = (entries: ZipEntry[]): Blob =>
  new Blob([zipBytes(entries)], { type: 'application/zip' })

// ---------------------------------------------------------------------------

/**
 * zip 을 풀어 «이름 -> 내용» 으로.
 *
 * **중앙 디렉터리를 기준으로 읽는다.** 파일 앞에서부터 훑는 방법도 있지만,
 * 끝에 있는 목록이 그 zip 의 «정본» 이라 그쪽이 맞다.
 */
export function unzip(buf: ArrayBuffer): Map<string, Uint8Array> {
  const all = new Uint8Array(buf)
  const v = new DataView(buf)
  const dec = new TextDecoder()

  // 끝 표시를 뒤에서부터 찾는다 (설명이 붙어 있을 수 있어 마지막 22바이트가 아닐 수 있다)
  let eocd = -1
  for (let i = all.length - 22; i >= Math.max(0, all.length - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('zip 파일이 아닙니다')

  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const out = new Map<string, Uint8Array>()

  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('zip 목록이 깨졌습니다')
    const method = v.getUint16(p + 10, true)
    const size = v.getUint32(p + 24, true)
    const nameLen = v.getUint16(p + 28, true)
    const extraLen = v.getUint16(p + 30, true)
    const commentLen = v.getUint16(p + 32, true)
    const at = v.getUint32(p + 42, true)
    const name = dec.decode(all.subarray(p + 46, p + 46 + nameLen))

    if (method !== STORED) throw new Error(`«${name}» 이 압축돼 있어 읽지 못합니다`)

    // 데이터는 로컬 헤더 바로 뒤에 있다. 이름·여분 길이는 로컬 헤더 것을 봐야 한다
    // (중앙 디렉터리와 다를 수 있다)
    if (v.getUint32(at, true) !== 0x04034b50) throw new Error('zip 항목이 깨졌습니다')
    const start = at + 30 + v.getUint16(at + 26, true) + v.getUint16(at + 28, true)
    const data = all.subarray(start, start + size)
    if (crc32(data) !== v.getUint32(p + 16, true)) throw new Error(`«${name}» 의 내용이 깨졌습니다`)
    out.set(name, data)

    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}
