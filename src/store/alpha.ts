/**
 * 이미지 알파맵 캐시 — «이 그림의 이 자리가 비어 있나» 를 알기 위한 것.
 *
 * 투명한 곳을 눌렀을 때 뒤 레이어를 잡으려면 그림의 알파 채널을 봐야 한다.
 * 원본 해상도는 필요 없다. 클릭 판정에는 **축소본이면 충분**하고,
 * 카드 한 벌 분량의 그림을 다 들고 있어도 몇백 KB 다.
 *
 * 아직 안 읽힌 그림은 `undefined` 를 돌려준다 — 히트 테스트가 그걸
 * «상자 전체 불투명» 으로 보므로 예전과 같이 동작한다. 읽히면 그때부터 정확해진다.
 */

import type { AlphaMap } from '../core/hit.ts'
import { getBlob } from './assets.ts'

/** 축소본의 장변 (px). 63mm 카드에서 한 화소가 0.2mm 남짓 — 클릭 판정에 충분하다. */
const MAX_SIDE = 256

/** null = 읽어봤지만 못 읽음. 다시 시도하지 않는다. */
const cache = new Map<string, AlphaMap | null>()
const inflight = new Map<string, Promise<void>>()

export function alphaOf(id: string): AlphaMap | undefined {
  return cache.get(id) ?? undefined
}

async function load(id: string): Promise<void> {
  try {
    const blob = await getBlob(id)
    if (!blob) {
      cache.set(id, null)
      return
    }
    const bmp = await createImageBitmap(blob)
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))

    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    if (!ctx) {
      cache.set(id, null)
      return
    }
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close()

    const px = ctx.getImageData(0, 0, w, h).data
    const a = new Uint8Array(w * h)
    for (let i = 0; i < a.length; i++) a[i] = px[i * 4 + 3]!
    cache.set(id, { w, h, a })
  } catch {
    // 읽기 실패는 조용히 넘긴다. 못 읽으면 예전처럼 상자로 잡히는 것뿐이다.
    cache.set(id, null)
  }
}

/** 지금 화면에 쓰이는 그림들을 미리 읽어둔다. 이미 읽은 건 건너뛴다. */
export function warmAlpha(ids: Iterable<string>): void {
  for (const id of ids) {
    if (!id || cache.has(id) || inflight.has(id)) continue
    const p = load(id).finally(() => inflight.delete(id))
    inflight.set(id, p)
  }
}
