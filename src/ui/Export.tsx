/**
 * PNG 내보내기 창.
 *
 * 인쇄용이 아니라 **보여주고 피드백 받으려고** 있는 기능이다.
 * 그래서 «지금 이 카드» 와 «덱 전체 모아보기» 두 가지만 있으면 된다.
 */

import { useState } from 'react'
import { exportPng, type PngItem } from '../core/png.ts'
import { downloadBlob } from '../core/download.ts'
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
  /** 보드는 «한 장» 뿐이라 «덱 전체» 가 없다. 격자·뒷면도 해당 없음 */
  const boardMode = s.mode === 'board'
  /** 룰북은 «전체» 가 있다 — 쪽을 격자로 늘어놓으면 흐름을 한눈에 볼 수 있다 */
  const bookMode = s.mode === 'book'
  const book = bookMode ? s.rulebook() : undefined

  const run = async (what: 'one' | 'deck', label: string) => {
    setBusy(label)
    setErr(null)
    try {
      const items: PngItem[] =
        what === 'one'
          ? [{ component: here, instance: inst }]
          : bookMode
          ? (book?.pages ?? []).map((pg) => ({ component: here, instance: pg }))
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
          } else if ((l.kind === 'text' || l.kind === 'md') && l.font && !l.font.startsWith('var(')) {
            families.add(l.font)
          }
        }
      }

      const blob = await exportPng(items, {
        scale: dpi / 96,
        // 뒷면이 있으면 앞·뒤가 한 줄에 짝으로 들어가야 하므로 짝수 칸으로 맞춘다.
        // 룰북에는 뒷면이 없으니 그대로 둔다 (지금 고른 덱의 뒷면에 끌려가면 안 된다).
        cols: !bookMode && back ? Math.max(2, cols - (cols % 2)) : cols,
        keywords: s.project.keywords,
        assets: await assetDataUrls(ids),
        fontCss: await fontFaceCss(families),
      })

      // 보드는 한 장이라 번호가 없다. 이름만 붙인다.
      const name = boardMode
        ? `${safe(s.project.name)}-${safe(here.name)}.png`
        : bookMode
          ? `${safe(s.project.name)}-${safe(book?.name ?? '룰북')}${
              what === 'one' ? `-${(book?.pages.findIndex((p) => p.id === inst?.id) ?? 0) + 1}` : '-전체'
            }.png`
          : what === 'one'
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
            {boardMode ? '보드' : bookMode ? '쪽 한 장' : '카드 한 장'} = {px(here.size.w)} × {px(here.size.h)} px
          </span>
        </div>

        {/* 보드는 한 장이라 격자가 없다 */}
        {!boardMode && (
          <div className="cfree">
            <span>한 줄에</span>
            <select value={cols} onChange={(e) => setCols(Number(e.target.value))}>
              {[2, 3, 4, 5, 6, 8].map((n) => (
                <option key={n} value={n}>
                  {n}장
                </option>
              ))}
            </select>
            <span className="grow">
              {bookMode ? '룰북 전체로 뽑을 때만 씁니다' : '덱 전체로 뽑을 때만 씁니다'}
              {!bookMode && back ? ' · 뒷면이 있어 앞·뒤가 나란히 들어갑니다' : ''}
            </span>
          </div>
        )}

        <div className="rowbtn">
          <button className="go" disabled={!!busy} onClick={() => void run('one', '이 카드')}>
            {busy === '이 카드' ? '만드는 중…' : boardMode ? '이 보드' : bookMode ? '이 쪽' : '이 카드'}
          </button>
          {!boardMode && (
            <button disabled={!!busy} onClick={() => void run('deck', '덱 전체')}>
              {busy === '덱 전체'
                ? '만드는 중…'
                : bookMode
                  ? `룰북 전체 (${book?.pages.length ?? 0}쪽)`
                  : `덱 전체 (${deck.instances.length}장)`}
            </button>
          )}
          <button disabled={!!busy} onClick={onClose}>
            취소
          </button>
        </div>

        {err && <p className="hint sm nopad warn">{err}</p>}
        <p className="hint sm nopad">
          {boardMode ? (
            <>
              보드 전체를 여백 없이 판 크기 그대로 한 장으로 뽑습니다. 300dpi 로 A3 판을 뽑으면{' '}
              {px(here.size.w)}×{px(here.size.h)}px 이라 파일이 큽니다 — 화면으로 보여줄 것이면
              150dpi 로 충분합니다.
            </>
          ) : (
            <>
              «이 카드» 는 여백 없이 카드 크기 그대로 나옵니다. «덱 전체» 는 격자로 모아 흰 여백을 둡니다.
              {s.side === 'back' && ' 지금 뒷면을 편집 중이라 «이 카드» 는 뒷면으로 나옵니다.'}
            </>
          )}
        </p>
      </div>
    </div>
  )
}
