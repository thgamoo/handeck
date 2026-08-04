/**
 * 편집 캔버스.
 *
 * 실제 렌더 결과(core/render)를 그대로 깔고, 그 위에 투명한 조작 핸들을 얹는다.
 * 미리보기를 따로 그리지 않는다 — «편집기에선 이런데 인쇄는 저렇다» 가 생기지 않는다.
 *
 * 좌표는 mm 로만 다룬다. 화면 배율(px/mm)은 마지막에 한 번만 곱한다.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { cssMmPx, mmPx as mm1, screenVersion, subscribeScreen } from '../store/screen.ts'
import { Piece, fullSize } from '../core/render.tsx'
import { resolveAsset, type ImageLayer, type Layer } from '../core/model.ts'
import { useStore } from '../store/project.ts'
import { assetUrl, putAsset, warmUrls } from '../store/assets.ts'
import { alphaOf, warmAlpha } from '../store/alpha.ts'
import { hitLayer, pickLayer, type Box, type Point, type Probe } from '../core/hit.ts'
import { snapEdge, snapMove, type SnapTarget } from '../core/snap.ts'
import { Ruler } from './Ruler.tsx'

type Corner = 'nw' | 'ne' | 'sw' | 'se'
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']

export function Canvas({ zoom, rulers = true }: { zoom: number; rulers?: boolean }) {
  const s = useStore()
  const c = s.component()
  const inst = s.instance()
  // 화면 보정이 바뀌면 다시 그린다 — «100%» 가 실물 크기여야 한다
  useSyncExternalStore(subscribeScreen, screenVersion)
  const mmPx = mm1() * zoom
  const f = fullSize(c)
  const [dropping, setDropping] = useState(false)
  // 끄는 동안만 보이는 정렬 가이드
  const [gx, setGx] = useState<SnapTarget[]>([])
  const [gy, setGy] = useState<SnapTarget[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const pendingLayer = useRef<string | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  /** 지금 눌렀을 때 잡힐 레이어 — 테두리로 미리 보여준다 */
  const [hoverId, setHoverId] = useState<string | null>(null)
  /** 눈금자에 표시할 마우스 자리 (mm) */
  const [cursor, setCursor] = useState<Point | null>(null)
  const dragging = useRef(false)

  // 히트 테스트에 쓸 그림들의 알파를 미리 읽어둔다.
  // 다 읽히기 전엔 예전처럼 상자로 잡히고, 읽히는 대로 정확해진다.
  useEffect(() => {
    const ids: string[] = []
    for (const l of c.layers) {
      if (l.kind !== 'image') continue
      const id = resolveAsset(l, inst)
      if (id) ids.push(id)
    }
    warmAlpha(ids)
  }, [c, inst])

  /**
   * 글자가 실제로 차지하는 줄 상자 — 렌더된 DOM 에서 잰다.
   *
   * 글꼴·줄바꿈·정렬을 우리가 다시 계산하지 않는다. 이미 브라우저가
   * 그려놓은 걸 재는 게 정확하고, 렌더 코드와 어긋날 일도 없다.
   */
  const textBoxes = useRef(new Map<string, Box[]>())
  useEffect(() => {
    textBoxes.current.clear() // 글자·배율이 바뀌면 다시 잰다
  }, [c, inst, mmPx])

  const measureText = useCallback(
    (layerId: string): Box[] | undefined => {
      const hit = textBoxes.current.get(layerId)
      if (hit) return hit
      const root = canvasRef.current
      const l = c.layers.find((x) => x.id === layerId)
      if (!root || !l) return undefined
      const el = root.querySelector(`[data-layer="${CSS.escape(layerId)}"] span`)
      if (!el) return undefined
      const range = document.createRange()
      range.selectNodeContents(el)
      const rc = root.getBoundingClientRect()
      const boxes = [...range.getClientRects()].map((r) => ({
        x: (r.left - rc.left) / mmPx - l.x,
        y: (r.top - rc.top) / mmPx - l.y,
        w: r.width / mmPx,
        h: r.height / mmPx,
      }))
      if (boxes.length > 0) textBoxes.current.set(layerId, boxes)
      return boxes
    },
    [c.layers, mmPx]
  )

  const probe = useRef<Probe>({})
  probe.current = { alpha: alphaOf, textBoxes: measureText }

  const pointAt = useCallback(
    (e: { clientX: number; clientY: number }): Point | null => {
      const rc = canvasRef.current?.getBoundingClientRect()
      if (!rc) return null
      return { x: (e.clientX - rc.left) / mmPx, y: (e.clientY - rc.top) / mmPx }
    },
    [mmPx]
  )

  /**
   * 이 지점에서 실제로 잡힐 레이어. 투명한 곳이면 그 뒤가 잡힌다.
   * **Ctrl 을 누르고 누르면 투명을 무시**하고 맨 위 상자를 잡는다 —
   * 아주 옅은 그늘처럼 «보이는데 안 잡히는» 것을 위한 탈출구다.
   */
  const pickAt = useCallback(
    (e: { clientX: number; clientY: number; ctrlKey?: boolean; metaKey?: boolean }): Layer | null => {
      const p = pointAt(e)
      if (!p) return null
      return pickLayer(c.layers, p, inst, s.layerId, probe.current, !!(e.ctrlKey || e.metaKey))
    },
    [c.layers, inst, pointAt, s.layerId]
  )

  /** 그림을 특정 이미지 레이어에 넣는다. 오버라이드면 이 카드에만, 아니면 공통. */
  const assign = useCallback(
    async (layer: ImageLayer, file: File | Blob) => {
      const meta = await putAsset(file)
      await warmUrls([meta.id])
      if (layer.override === 'image' && inst) s.setValue(inst.id, layer.id, meta.id)
      else s.patchLayer(layer.id, { asset: meta.id })
    },
    [inst, s]
  )

  /** 캔버스 어디에 떨궈도, 그 지점에 있는 이미지 레이어를 찾아 넣는다. */
  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setDropping(false)
      const file = e.dataTransfer.files?.[0]
      if (!file || !file.type.startsWith('image/')) return

      // 고를 때와 같은 판정을 쓴다 — «눌러서 잡히는 것» 과 «떨궈서 들어가는 것» 이 어긋나면 안 된다.
      // 다만 여기서는 그림이 들어갈 수 있는 레이어만 본다.
      const p = pointAt(e)
      const hit = p
        ? [...c.layers]
            .reverse()
            .find((l): l is ImageLayer => l.kind === 'image' && hitLayer(l, p, inst, probe.current))
        : undefined
      const target = hit ?? c.layers.find((l): l is ImageLayer => l.kind === 'image')
      if (target) await assign(target, file)
    },
    [assign, c.layers, inst, pointAt]
  )

  const pickFor = (layer: Layer) => {
    if (layer.kind !== 'image') return
    pendingLayer.current = layer.id
    fileInput.current?.click()
  }

  const start = useCallback(
    (e: React.MouseEvent, l: Layer, corner?: Corner) => {
      e.preventDefault()
      e.stopPropagation()
      s.selectLayer(l.id)
      if (l.locked) return

      // 드래그 시작 시점을 한 번만 기록한다. 중간 경로는 히스토리에 안 남는다.
      s.beginGesture()
      dragging.current = true

      const x0 = e.clientX
      const y0 = e.clientY
      const o = { x: l.x, y: l.y, w: l.w, h: l.h }
      const snap = (v: number) => Math.round(v * 10) / 10

      const others = c.layers
      const move = (ev: MouseEvent) => {
        const dx = (ev.clientX - x0) / mmPx
        const dy = (ev.clientY - y0) / mmPx
        // Alt 를 누르면 스냅을 끈다 (미세 조정용)
        const noSnap = ev.altKey

        if (!corner) {
          let nx = snap(o.x + dx)
          let ny = snap(o.y + dy)
          if (!noSnap) {
            const r = snapMove({ x: nx, y: ny }, { ...l, ...o }, others, c.size, mmPx)
            nx = snap(r.x)
            ny = snap(r.y)
            setGx(r.guidesX)
            setGy(r.guidesY)
          } else {
            setGx([])
            setGy([])
          }
          s.patchLayerLive(l.id, { x: nx, y: ny })
          return
        }

        const p: Partial<Layer> = {}
        const hitsX: SnapTarget[] = []
        const hitsY: SnapTarget[] = []
        const fit = (v: number, axis: 'x' | 'y') => {
          if (noSnap) return v
          const r = snapEdge(v, axis, { ...l, ...o }, others, c.size, mmPx)
          ;(axis === 'x' ? hitsX : hitsY).push(...r.hits)
          return r.value
        }

        if (corner.includes('e')) p.w = Math.max(2, snap(fit(o.x + o.w + dx, 'x') - o.x))
        if (corner.includes('s')) p.h = Math.max(2, snap(fit(o.y + o.h + dy, 'y') - o.y))
        if (corner.includes('w')) {
          const left = snap(fit(o.x + dx, 'x'))
          p.x = left
          p.w = Math.max(2, snap(o.x + o.w - left))
        }
        if (corner.includes('n')) {
          const top = snap(fit(o.y + dy, 'y'))
          p.y = top
          p.h = Math.max(2, snap(o.y + o.h - top))
        }
        setGx(hitsX)
        setGy(hitsY)
        s.patchLayerLive(l.id, p)
      }
      const up = () => {
        s.commitGesture() // 놓았을 때 한 번만 히스토리에 남긴다
        dragging.current = false
        setGx([])
        setGy([])
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    },
    [mmPx, s, c.layers, c.size]
  )

  // 방향키로 미세 조정
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
      if (!s.layerId || !e.key.startsWith('Arrow')) return
      const l = s.layer()
      if (!l) return
      e.preventDefault()
      const d = e.shiftKey ? 1 : 0.1
      const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0
      const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0
      s.patchLayer(
        l.id,
        { x: Math.round((l.x + dx) * 10) / 10, y: Math.round((l.y + dy) * 10) / 10 },
        `nudge:${l.id}`
      )
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s])

  const deck = s.deck()
  const sel = s.layer()

  return (
    <div className="stage" onMouseDown={() => s.selectLayer(null)}>
      {/* 앞면/뒷면 — 덱마다 틀이 둘일 수 있는데 화면은 하나다.
          여기가 그 둘 사이를 오가는 유일한 자리라 판 바로 위에 붙인다. */}
      <div className="sides" onMouseDown={(e) => e.stopPropagation()}>
        <button className={s.side === 'front' ? 'on' : ''} onClick={() => s.selectSide('front')}>
          앞면
        </button>
        {deck.back ? (
          <button className={s.side === 'back' ? 'on' : ''} onClick={() => s.selectSide('back')}>
            뒷면
          </button>
        ) : (
          <button
            className="add"
            title="이 덱에 공통 뒷면을 만듭니다. 앞면과 같은 규격으로 시작합니다."
            onClick={() => s.setBack('new')}
          >
            + 뒷면
          </button>
        )}
        <span className="who">{deck.name}</span>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0]
          const id = pendingLayer.current
          e.target.value = ''
          if (!file || !id) return
          const layer = c.layers.find((l) => l.id === id)
          if (layer?.kind === 'image') await assign(layer, file)
        }}
      />

      {/* 눈금자는 판 «옆에» 붙여 같이 움직이게 둔다. 화면 가장자리에 고정하면
          확대·스크롤할 때마다 판과 어긋나 맞춰주는 코드가 따라붙는다. */}
      <div className={`board${rulers ? ' withruler' : ''}`}>
        {rulers && (
          <>
            <div className="rcorner">mm</div>
            <Ruler
              axis="x"
              len={f.w}
              mmPx={mmPx}
              cursor={cursor?.x}
              span={sel ? { from: sel.x, to: sel.x + sel.w } : undefined}
            />
            <Ruler
              axis="y"
              len={f.h}
              mmPx={mmPx}
              cursor={cursor?.y}
              span={sel ? { from: sel.y, to: sel.y + sel.h } : undefined}
            />
          </>
        )}
      <div
        ref={canvasRef}
        className={`canvas${dropping ? ' dropping' : ''}`}
        style={{
          width: f.w * mmPx,
          height: f.h * mmPx,
          // **판 = 카드.** 도련도 안내선도 없다. 원형 조각이면 판 자체가 둥글다 —
          // 네모난 판 안에 둥근 조각을 그리고 안내선으로 알려주는 것보다 정직하다.
          borderRadius: c.size.shape === 'circle' ? '50%' : undefined,
          cursor: hoverId && !c.layers.find((l) => l.id === hoverId)?.locked ? 'move' : 'default',
        }}
        /* 레이어를 고르는 자리는 **여기 하나뿐**이다.
           조작 상자마다 mousedown 을 달면 «위에 있는 상자» 가 무조건 이겨서
           투명한 데를 눌러도 그게 잡힌다. */
        onMouseDown={(e) => {
          e.stopPropagation()
          const l = pickAt(e)
          if (l) start(e, l)
          else s.selectLayer(null) // 아무것도 안 칠해진 곳 — 선택 해제
        }}
        onDoubleClick={(e) => {
          const l = pickAt(e)
          if (l) pickFor(l)
        }}
        onMouseMove={(e) => {
          setCursor(pointAt(e))
          if (dragging.current) return
          setHoverId(pickAt(e)?.id ?? null)
        }}
        onMouseLeave={() => {
          setHoverId(null)
          setCursor(null)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDropping(true)
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
      >
        {/* 실제 렌더 — 인쇄와 같은 코드. mm 로 그려진 걸 화면 배율만큼 확대한다.
            [주의] 배율은 `zoom` 이 아니라 **`mmPx / 브라우저 mm`** 다.
            `Piece` 는 CSS 의 mm 로 그려지는데 그건 96dpi 가정값이라 화면 보정이 안 들어 있다.
            여기서 zoom 만 곱하면 판(보정 반영)과 그림(보정 없음)이 어긋난다 —
            크기는 맞는데 좌표가 밀리는 게 정확히 이 증상이었다. */}
        <div
          style={{
            transform: `scale(${mmPx / cssMmPx()})`,
            transformOrigin: '0 0',
            position: 'absolute',
            inset: 0,
          }}
        >
          <Piece component={c} instance={inst} opts={{ assetUrl, keywords: s.project.keywords }} />
        </div>

        <div className="overlay">
          {c.layers.map((l) =>
            l.hidden ? null : (
              /* 이 상자는 **보여주기만** 한다 (`pointer-events: none`).
                 누르는 건 캔버스가 받아서 히트 테스트로 정한다.
                 여기 달린 핸들과 «그림 넣기» 만 예외로 클릭을 받는다. */
              <div
                key={l.id}
                className={`hbox${s.layerId === l.id ? ' sel' : ''}${
                  hoverId === l.id && s.layerId !== l.id ? ' hov' : ''
                }${l.locked ? ' lock' : ''}`}
                style={{
                  left: l.x * mmPx,
                  top: l.y * mmPx,
                  width: l.w * mmPx,
                  height: l.h * mmPx,
                }}
              >
                {s.layerId === l.id && (
                  <>
                    <span className="tag">
                      {l.name}
                      {l.override ? ' · 카드마다' : ''}
                    </span>
                    {l.kind === 'image' && (
                      <button
                        className="pick"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => pickFor(l)}
                      >
                        그림 넣기
                      </button>
                    )}
                    {CORNERS.map((k) => (
                      <i key={k} className={`hdl ${k}`} onMouseDown={(e) => start(e, l, k)} />
                    ))}
                  </>
                )}
              </div>
            )
          )}
        </div>

        {(gx.length > 0 || gy.length > 0) && (
          <div className="guides">
            {gx.map((t, i) => (
              <span
                key={`x${i}`}
                className={`gl v ${t.kind}`}
                style={{
                  left: t.at * mmPx,
                  ...(t.span
                    ? { top: t.span.from * mmPx - 6, height: (t.span.to - t.span.from) * mmPx + 12 }
                    : {}),
                }}
              >
                {t.label && <b>{t.label}</b>}
              </span>
            ))}
            {gy.map((t, i) => (
              <span
                key={`y${i}`}
                className={`gl h ${t.kind}`}
                style={{
                  top: t.at * mmPx,
                  ...(t.span
                    ? { left: t.span.from * mmPx - 6, width: (t.span.to - t.span.from) * mmPx + 12 }
                    : {}),
                }}
              >
                {t.label && <b>{t.label}</b>}
              </span>
            ))}
          </div>
        )}

        {dropping && <div className="dropmsg">여기에 놓으면 그림이 들어갑니다</div>}
      </div>
      </div>

      {/* 판 = 카드 실물 크기. 딱 그것뿐이다 — 도련은 인쇄 화면에서 붙는다.
          크기를 누르면 오른쪽 «조각» 이 펼쳐진다 — 접혀 있어서 못 찾는다는 말이 있었다. */}
      <div className="dims">
        <button
          className="sizebtn"
          title="조각 크기·모양 바꾸기"
          onClick={() => {
            const el = document.getElementById('setup-piece') as HTMLDetailsElement | null
            if (!el) return
            el.open = true
            el.scrollIntoView({ block: 'nearest' })
            el.querySelector('select')?.focus()
          }}
        >
          <b>{c.size.shape === 'circle' ? `지름 ${c.size.w}` : `${c.size.w} × ${c.size.h}`} mm</b>
          <span className="caret">▾</span>
        </button>
        <span className="q">판의 크기가 곧 카드의 크기입니다</span>
        <span className="q">· 투명한 곳을 눌러도 잡으려면 Ctrl + 클릭</span>
      </div>
    </div>
  )
}
