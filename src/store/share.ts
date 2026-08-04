/**
 * 묶음 주고받기 — 저장소(IndexedDB)와 묶음 파일 사이.
 *
 * 형식 자체는 `core/bundle.ts` 가 안다. 여기서는 **어디서 꺼내 어디에 넣는지**만 한다.
 */

import { buildBundle, parseBundle, type Bytes, type ParsedBundle } from '../core/bundle.ts'
import type { Project } from '../core/model.ts'
import { getAssetFile, putAsset, warmUrls } from './assets.ts'
import { getFontFile, importFont } from './fonts.ts'
import { usedAssets } from './project.ts'
import { migrate } from './persist.ts'

const bytes = async (b: Blob): Promise<Bytes> => new Uint8Array(await b.arrayBuffer())

/** 이 프로젝트가 쓰는 것을 전부 담은 한 덩어리 */
export async function exportBundle(project: Project): Promise<{ blob: Blob; missing: string[] }> {
  const missing: string[] = []

  const assets = []
  for (const id of usedAssets(project)) {
    const got = await getAssetFile(id)
    if (!got) {
      // 저장소에서 사라진 그림. 묶음은 만들되 무엇이 빠졌는지 알려준다.
      missing.push(`그림 ${id}`)
      continue
    }
    assets.push({
      id,
      name: got.meta.name,
      type: got.meta.type,
      size: got.meta.size,
      data: await bytes(got.blob),
    })
  }

  const fonts = []
  for (const ref of project.fonts ?? []) {
    const got = await getFontFile(ref.id)
    if (!got) {
      missing.push(`글꼴 ${ref.name}`)
      continue
    }
    fonts.push({
      id: ref.id,
      // 프로젝트가 가리키는 이름을 쓴다 — 글자 레이어가 그걸 보고 있다
      family: ref.family,
      name: got.meta.name,
      type: got.meta.type,
      size: got.meta.size,
      data: await bytes(got.blob),
    })
  }

  return { blob: buildBundle({ project, assets, fonts }), missing }
}

/**
 * 묶음을 이 브라우저로 들인다.
 *
 * 그림·글꼴을 저장소에 넣고, **필요하면 프로젝트를 고쳐서** 돌려준다.
 * 고칠 일이 생기는 건 글꼴 이름이 부딪힐 때뿐이다 (아래 참조).
 */
export async function importBundle(buf: ArrayBuffer): Promise<{ project: Project; warnings: string[] }> {
  const parsed: ParsedBundle = parseBundle(buf)
  const warnings = [...parsed.warnings]

  for (const a of parsed.assets) {
    const file = new File([a.data as BlobPart], a.name, { type: a.type || 'image/png' })
    try {
      const meta = await putAsset(file)
      // id 는 내용 해시다. 넣어보고 다른 id 가 나오면 **내용이 바뀐 것**이다.
      // 프로젝트는 원래 id 를 가리키므로 그 그림은 빈 칸이 된다.
      if (meta.id !== a.id) warnings.push(`그림 «${a.name}» 의 내용이 묶음과 다릅니다`)
    } catch {
      warnings.push(`그림 «${a.name}» 을 넣지 못했습니다`)
    }
  }

  /**
   * 글꼴 이름 충돌.
   *
   * id 는 안 부딪히지만 **이름은 부딪힌다** — 받는 쪽에 이미 «Pretendard» 라는
   * 다른 파일이 있을 수 있다. 그때는 들어온 글꼴 이름을 바꾸고,
   * **그 이름을 보고 있던 글자 레이어까지 같이 고쳐야** 한다.
   */
  const renamed = new Map<string, string>()
  for (const f of parsed.fonts) {
    const file = new File([f.data as BlobPart], f.name, { type: f.type || 'font/ttf' })
    try {
      const meta = await importFont(file, f.family)
      if (meta.family !== f.family) {
        renamed.set(f.family, meta.family)
        warnings.push(`글꼴 이름이 겹쳐 «${f.family}» 을 «${meta.family}» 으로 바꿨습니다`)
      }
    } catch {
      warnings.push(`글꼴 «${f.name}» 을 넣지 못했습니다`)
    }
  }

  const project = migrate(parsed.project)
  if (renamed.size > 0) {
    for (const ref of project.fonts ?? []) {
      const next = renamed.get(ref.family)
      if (next) ref.family = next
    }
    for (const c of Object.values(project.components)) {
      for (const l of c.layers) {
        if (l.kind !== 'text' || !l.font) continue
        const next = renamed.get(l.font)
        if (next) l.font = next
      }
    }
  }

  await warmUrls(usedAssets(project))
  return { project, warnings }
}
