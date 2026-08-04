/**
 * 묶음(`.handeck`) — 프로젝트를 **한 파일로** 건네기.
 *
 * `project.json` 은 가볍지만 **그림과 글꼴을 들고 있지 않다** (그건 브라우저
 * 저장소에 있다). 그래서 그 파일만 건네면 받는 쪽에서 빈 칸과 대체 글꼴이 나온다.
 * 묶음은 그 셋을 zip 하나로 담는다.
 *
 * ```
 * <프로젝트>.handeck
 * ├─ project.json      ← 지금 쓰는 그 형식 그대로. 이것만 빼서 써도 된다
 * ├─ bundle.json       ← 목록(무엇이 몇 개, 얼마나 큰지)
 * ├─ assets/<id>.png   ← 파일 이름이 곧 id
 * └─ fonts/<id>.ttf
 * ```
 *
 * **id 는 내용 해시다.** 그래서 짝맞추기가 저절로 된다 —
 * 같은 파일은 같은 id 라 받는 쪽에 이미 있으면 건너뛰고, 다른 파일은 안 부딪힌다.
 * 넣을 때 다시 해시해보면 **내용이 바뀌었는지도 그 자리에서 드러난다.**
 *
 * `bundle.json` 을 따로 두는 이유: 열기 전에 «그림 12개, 글꼴 2개, 8MB» 를
 * 보여줄 수 있고, 빠진 게 있으면 무엇이 없는지 이름으로 짚어줄 수 있다.
 */

import type { Project } from './model.ts'
import { unzip, zipBytes, type ZipEntry } from './zip.ts'

export const BUNDLE_EXT = '.handeck'

export interface BundleAsset {
  id: string
  /** 원래 파일 이름 — 없을 때 무엇을 찾아야 하는지 알려주려고 */
  name: string
  type: string
  size: number
}

export interface BundleFont extends BundleAsset {
  /** 글자 레이어가 가리키는 이름 */
  family: string
}

export interface Manifest {
  handeck: 1
  kind: 'bundle'
  /** 묶음 형식 판. 나중에 담는 게 늘어나면 올린다 */
  bundle: 1
  assets: BundleAsset[]
  fonts: BundleFont[]
}

/** zip 에 넣을 바이트. `ArrayBuffer` 로 못박아야 `Blob` 에 그대로 들어간다 */
export type Bytes = Uint8Array<ArrayBuffer>

export interface BundleInput {
  project: Project
  assets: (BundleAsset & { data: Bytes })[]
  fonts: (BundleFont & { data: Bytes })[]
}

/** `image/png` -> `png`. 모르는 형식이면 `bin`. */
function ext(type: string, name: string): string {
  const fromName = /\.([a-z0-9]{2,5})$/i.exec(name)?.[1]?.toLowerCase()
  if (fromName) return fromName
  const m = /\/(?:x-)?([a-z0-9.+-]+)$/i.exec(type)?.[1]?.toLowerCase()
  if (!m) return 'bin'
  return m === 'jpeg' ? 'jpg' : m.replace(/^vnd\..*$/, 'bin')
}

const utf8 = new TextEncoder()
// TextEncoder 는 늘 새 ArrayBuffer 를 만든다 — 공유 버퍼일 수 없다
const json = (v: unknown): Bytes => utf8.encode(JSON.stringify(v, null, 2)) as Bytes

export function buildBundleBytes(input: BundleInput): Bytes {
  const manifest: Manifest = {
    handeck: 1,
    kind: 'bundle',
    bundle: 1,
    assets: input.assets.map(({ id, name, type, size }) => ({ id, name, type, size })),
    fonts: input.fonts.map(({ id, name, type, size, family }) => ({ id, name, type, size, family })),
  }

  const entries: ZipEntry[] = [
    { name: 'project.json', data: json(input.project) },
    { name: 'bundle.json', data: json(manifest) },
    ...input.assets.map((a) => ({ name: `assets/${a.id}.${ext(a.type, a.name)}`, data: a.data })),
    ...input.fonts.map((f) => ({ name: `fonts/${f.id}.${ext(f.type, f.name)}`, data: f.data })),
  ]
  return zipBytes(entries)
}

export const buildBundle = (input: BundleInput): Blob =>
  new Blob([buildBundleBytes(input)], { type: 'application/zip' })

export interface ParsedBundle {
  project: Project
  manifest: Manifest | null
  /** 실제로 들어 있던 것들 */
  assets: { id: string; name: string; type: string; data: Uint8Array }[]
  fonts: { id: string; family: string; name: string; type: string; data: Uint8Array }[]
  /** 열 수는 있지만 알아둬야 할 것들 */
  warnings: string[]
}

/** 파일 이름이 zip 이 아닌 걸 가리켜도, 앞 네 바이트를 보면 알 수 있다 */
export function looksLikeZip(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 4) return false
  const b = new Uint8Array(buf, 0, 4)
  return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
}

export function parseBundle(buf: ArrayBuffer): ParsedBundle {
  const files = unzip(buf)
  const dec = new TextDecoder()
  const warnings: string[] = []

  const projectRaw = files.get('project.json')
  if (!projectRaw) throw new Error('묶음 안에 project.json 이 없습니다')
  const project = JSON.parse(dec.decode(projectRaw)) as Project
  if (project?.handeck !== 1) throw new Error('handeck 프로젝트가 아닙니다')

  let manifest: Manifest | null = null
  const manifestRaw = files.get('bundle.json')
  if (manifestRaw) {
    try {
      manifest = JSON.parse(dec.decode(manifestRaw)) as Manifest
    } catch {
      warnings.push('목록(bundle.json)을 읽지 못했습니다. 들어 있는 파일로만 진행합니다.')
    }
  }

  /** `assets/ab12cd34.png` -> id 와 확장자 */
  const idOf = (path: string) => path.replace(/^[^/]+\//, '').replace(/\.[^.]*$/, '')

  const assets: ParsedBundle['assets'] = []
  const fonts: ParsedBundle['fonts'] = []
  for (const [path, data] of files) {
    if (path.startsWith('assets/')) {
      const id = idOf(path)
      const meta = manifest?.assets.find((a) => a.id === id)
      assets.push({ id, name: meta?.name ?? path.slice(7), type: meta?.type ?? '', data })
    } else if (path.startsWith('fonts/')) {
      const id = idOf(path)
      const meta = manifest?.fonts.find((f) => f.id === id)
      fonts.push({
        id,
        family: meta?.family ?? id,
        name: meta?.name ?? path.slice(6),
        type: meta?.type ?? '',
        data,
      })
    }
  }

  // 목록에 있다는데 실제로 없는 것 — 잘렸거나 손으로 지운 묶음이다
  for (const a of manifest?.assets ?? []) {
    if (!assets.some((x) => x.id === a.id)) warnings.push(`그림 «${a.name}» 이 묶음에 없습니다`)
  }
  for (const f of manifest?.fonts ?? []) {
    if (!fonts.some((x) => x.id === f.id)) warnings.push(`글꼴 «${f.name}» 이 묶음에 없습니다`)
  }

  return { project, manifest, assets, fonts, warnings }
}
