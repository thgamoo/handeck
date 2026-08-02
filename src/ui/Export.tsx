/**
 * PNG 내보내기 창.
 *
 * 인쇄용이 아니라 **보여주고 피드백 받으려고** 있는 기능이다.
 * 그래서 «지금 이 카드» 와 «덱 전체 모아보기» 두 가지만 있으면 된다.
 */

import { useState } from 'react'
import { downloadBlob, exportPng, type PngItem } from '../core/png.ts'
import { resolveAsset } from '../core/model.ts'
import { useStore } from '../store/project.ts'
import { assetDataUrls } from '../store/assets.ts'
import { fontFaceCss } from '../store/fonts.ts'

/** 96dpi 가 화면 기준. 인쇄물에 넣을 거면 300 이 관례다. */
const DPI = [96, 150, 300, 600]

/** 파일 이름에 못 쓰는 글자를 걷어낸다 */
const safe = (s: string): string => s.replace(/[\\/:*?"<>|]/g, '').trim() || 'handeck'

export function Export({ onClose }: { onClose: () => void }) {
  const s = useStore()
  const deck = s.deck()
  const [dpi, setDpi] = useState(300)
  const [cols, setCols] = useState(4)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const front = s.project.components[deck.component]
  const back = deck.back ? s.project.components[deck.back] : undefined
  const here = s.component()
  const inst = s.instance()

  const run = async (what: 'one' | 'deck', label: string) => {
    setBusy(label)
    setErr(null)
    try {
      const items: PngItem[] =
        what === 'one'
          ? [{ component: here, instance: inst }]
          : deck.instances.flatMap((i) => {
              const out: PngItem[] = [{ component: front!, instance: i }]
              // 뒷면이 있으면 앞·뒤를 나란히 — 피드백 받을 때 둘 다 보여야 한다
              if (back) out.push({ component: back, instance: i })
              return out
            })

      // 그림과 글꼴은 SVG 안으로 **직접 넣어야** 한다. 안 넣으면 조용히 빠진다.
      const ids = new Set<string>()
      const families = new Set<string>()
      for (const it of items) {
        for (const l of it.component.layers) {
          if (l.kind === 'image') {
            const id = resolveAsset(l, it.instance)
            if (id) ids.add(id)
          } else if (l.kind === 'text' && l.font && !l.font.startsWith('var(')) {
            families.add(l.font)
          }
        }
      }

      const blob = await exportPng(items, {
        scale: dpi / 96,
        cols: back ? Math.max(2, cols - (cols % 2)) : cols,
        keywords: s.project.keywords,
        assets: await assetDataUrls(ids),
        fontCss: await fontFaceCss(families),
      })

      const name =
        what === 'one'
          ? `${safe(s.project.name)}-${safe(deck.name)}-${(deck.instances.findIndex((i) => i.id === inst?.id) + 1) || 1}.png`
          : `${safe(s.project.name)}-${safe(deck.name)}-전체.png`
      downloadBlob(blob, name)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const px = (mm: number) => Math.round((mm / 25.4) * dpi)

  return (
    <div className="modal" onMouseDown={onClose}>
      <div className="sheetbox" onMouseDown={(e) => e.stopPropagation()}>
        <h3>PNG 내보내기</h3>
        <p className="hint nopad">
          화면·인쇄와 <b>같은 렌더 코드</b>로 그립니다. 보여주고 의견 받는 용도라면 300dpi 면 넉넉합니다.
        </p>

        <div className="cfree">
          <span>해상도</span>
          <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
            {DPI.map((d) => (
              <option key={d} value={d}>
                {d} dpi{d === 96 ? ' (화면)' : d === 300 ? ' (인쇄)' : ''}
              </option>
            ))}
          </select>
          <span className="grow">
            카드 한 장 = {px(here.size.w)} × {px(here.size.h)} px
          </span>
        </div>

        <div className="cfree">
          <span>한 줄에</span>
          <select value={cols} onChange={(e) => setCols(Number(e.target.value))}>
            {[2, 3, 4, 5, 6, 8].map((n) => (
              <option key={n} value={n}>
                {n}장
              </option>
            ))}
          </select>
          <span className="grow">덱 전체로 뽑을 때만 씁니다{back ? ' · 뒷면이 있어 앞·뒤가 나란히 들어갑니다' : ''}</span>
        </div>

        <div className="rowbtn">
          <button className="go" disabled={!!busy} onClick={() => void run('one', '이 카드')}>
            {busy === '이 카드' ? '만드는 중…' : '이 카드'}
          </button>
          <button disabled={!!busy} onClick={() => void run('deck', '덱 전체')}>
            {busy === '덱 전체' ? '만드는 중…' : `덱 전체 (${deck.instances.length}장)`}
          </button>
          <button disabled={!!busy} onClick={onClose}>
            취소
          </button>
        </div>

        {err && <p className="hint sm nopad warn">{err}</p>}
        <p className="hint sm nopad">
          «이 카드» 는 여백 없이 카드 크기 그대로 나옵니다. «덱 전체» 는 격자로 모아 흰 여백을 둡니다.
          {s.side === 'back' && ' 지금 뒷면을 편집 중이라 «이 카드» 는 뒷면으로 나옵니다.'}
        </p>
      </div>
    </div>
  )
}
