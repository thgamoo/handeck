/**
 * 오른쪽 패널 — 레이어 목록 + **선택한 레이어의 모든 것**.
 *
 * 그림 편집기의 관례를 따른다: 왼쪽은 목록, 레이어를 고르면 오른쪽에서 고친다.
 *
 * 순서가 중요하다.
 *   1) «이 카드의 값»  — 카드마다 다른 자리면 여기부터. 제일 자주 고치는 것이다.
 *   2) 위치·크기
 *   3) 공통 속성       — 모든 카드에 함께 적용된다는 걸 배지로 계속 알려준다
 */

import type { ChangeEvent } from 'react'
import { useRef, useState, useSyncExternalStore } from 'react'
import type { ImageLayer, Layer, TextLayer, RectLayer, GradientLayer } from '../core/model.ts'
import { BLEED_ENABLED, PIECE_PRESETS, usedColors } from '../core/model.ts'
import { layout } from '../core/impose.ts'
import { fontStack, gradientCss } from '../core/render.tsx'
import {
  fonts,
  fontsVersion,
  hasFont,
  importFont,
  removeFont,
  renameFont,
  subscribeFonts,
  type FontMeta,
} from '../store/fonts.ts'
import { useStore } from '../store/project.ts'
import { assetUrl, putAsset, warmUrls } from '../store/assets.ts'

const ICON: Record<Layer['kind'], string> = { image: '▣', text: 'T', rect: '▭', gradient: '▤' }

/* ── 작은 입력들 ─────────────────────────────────────── */

function Num({
  label,
  value,
  onChange,
  step = 0.5,
  min,
}: {
  label: string
  value: number | undefined
  onChange: (v: number) => void
  step?: number
  /** 지정하면 이보다 작은 값이 들어가지 않는다. 굵기·크기가 음수가 되는 걸 막는다. */
  min?: number
}) {
  return (
    <label className="f">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        value={value ?? ''}
        onChange={(e) => {
          const raw = Number(e.target.value)
          if (Number.isNaN(raw)) return
          onChange(min === undefined ? raw : Math.max(min, raw))
        }}
      />
    </label>
  )
}

function Txt({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string | undefined
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="f">
      <span>{label}</span>
      <input value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

/** 자주 쓰는 색. 카드에 어울리는 어두운 톤 위주로 골랐다. */
const PALETTE = [
  '#ffffff', '#f2ece4', '#cfc4ba', '#8a7d72', '#4a423b', '#241f1b', '#000000', 'transparent',
  '#b3261e', '#d4682a', '#e0a800', '#3f7d4e', '#2b6b8f', '#3d3a8f', '#7b3f8f', '#8f3f5e',
]

/** '#rrggbb' 만 네이티브 색 고르개에 넣을 수 있다. 아니면 검정으로 시작한다. */
function toHex(v?: string): string {
  return v && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : '#000000'
}

/**
 * 색 입력 — 글자로 직접 쓰거나, 오른쪽 끝 견본을 눌러 아래에서 골라 쓴다.
 *
 * 고르개를 띄우는 방식이 아니라 **아래로 펼친다**. 좁은 사이드바에서
 * 떠 있는 창은 다른 것을 가리고, 스크롤하면 어긋난다.
 */
function Color({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string | undefined
  onChange: (v: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const recent = usedColors(useStore().project).filter((c) => !PALETTE.includes(c))

  return (
    <div className={`colorf${open ? ' open' : ''}`}>
      <label className="f">
        <span>{label}</span>
        <span className="cwrap">
          <input value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
          <button
            type="button"
            className="cswatch"
            title="색 고르기"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            style={{ background: value?.trim() || 'transparent' }}
          />
        </span>
      </label>

      {open && (
        <div className="cpick">
          {recent.length > 0 && (
            <>
              <em>이 작업에 쓴 색</em>
              <div className="chips">
                {recent.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    className={c === value ? 'on' : undefined}
                    style={{ background: c }}
                    onClick={() => onChange(c)}
                  />
                ))}
              </div>
            </>
          )}
          <em>기본</em>
          <div className="chips">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                className={`${c === value ? 'on ' : ''}${c === 'transparent' ? 'none' : ''}`.trim() || undefined}
                style={c === 'transparent' ? undefined : { background: c }}
                onClick={() => onChange(c)}
              />
            ))}
          </div>
          <div className="cfree">
            <input type="color" value={toHex(value)} onChange={(e) => onChange(e.target.value)} />
            <span>직접 고르기</span>
            <button type="button" className="lnk" onClick={() => setOpen(false)}>
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** 그림 넣기 — 미리보기 + 파일 선택. 공통/카드별 양쪽에서 쓴다. */
function ImagePicker({
  assetId,
  onPick,
  onClear,
  hint,
}: {
  assetId?: string
  onPick: (f: File) => void
  onClear?: () => void
  hint?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const url = assetId ? assetUrl(assetId) : undefined
  return (
    <div className="imgpick">
      <button
        type="button"
        className={`drop${url ? ' has' : ''}`}
        onClick={() => input.current?.click()}
      >
        {url ? <img src={url} alt="" /> : <span className="none">{hint ?? '클릭해서 그림 넣기'}</span>}
      </button>
      <div className="rowbtn tight">
        <button type="button" onClick={() => input.current?.click()}>
          {url ? '바꾸기' : '그림 넣기'}
        </button>
        {url && onClear && (
          <button type="button" className="danger" onClick={onClear}>
            비우기
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) onPick(f)
        }}
      />
    </div>
  )
}

/* ── 패널 ────────────────────────────────────────────── */

export function Inspector() {
  const s = useStore()
  const layer = s.layer()
  const inst = s.instance()

  return (
    <aside className="right">
      {inst && (
        <div className="instbar">
          <span>카드 {s.deck().instances.findIndex((i) => i.id === inst.id) + 1}</span>
          <label>
            수량
            <input
              type="number"
              min={0}
              value={inst.qty}
              onChange={(e) =>
                s.edit(
                  (p) => {
                    const d = p.decks.find((x) => x.id === s.deckId)!
                    const t = d.instances.find((x) => x.id === inst.id)
                    if (t) t.qty = Math.max(0, Number(e.target.value) | 0)
                  },
                  `qty:${inst.id}`
                )
              }
            />
          </label>
        </div>
      )}

      <PieceSetup />
      <FontSetup />

      <h4>
        레이어
        <span className="allcards">위가 앞</span>
      </h4>
      <LayerList />
      <p className="hint sm nopad">끌어서 앞뒤 순서를 바꿉니다.</p>

      <div className="rowbtn">
        <button onClick={() => s.addLayer('text')}>+ 글자</button>
        <button onClick={() => s.addLayer('image')}>+ 이미지</button>
        <button onClick={() => s.addLayer('rect')}>+ 도형</button>
        <button onClick={() => s.addLayer('gradient')}>+ 그늘</button>
      </div>

      {!layer ? (
        <p className="hint">레이어를 고르면 여기서 고칠 수 있습니다.</p>
      ) : (
        <>
          {/* 1) 이 카드의 값 — 제일 자주 고치는 것이라 맨 위 */}
          {layer.override && inst && <InstanceValue layer={layer} />}

          {/* 2) 위치·크기 */}
          <h4>
            {layer.name}
            <span className="kindtag">{layer.kind}</span>
          </h4>
          <div className="grid2">
            <Num label="x" value={layer.x} onChange={(v) => s.patchLayer(layer.id, { x: v }, `x:${layer.id}`)} />
            <Num label="y" value={layer.y} onChange={(v) => s.patchLayer(layer.id, { y: v }, `y:${layer.id}`)} />
            <Num label="w" value={layer.w} min={0.5} onChange={(v) => s.patchLayer(layer.id, { w: v }, `w:${layer.id}`)} />
            <Num label="h" value={layer.h} min={0.5} onChange={(v) => s.patchLayer(layer.id, { h: v }, `h:${layer.id}`)} />
          </div>

          <label className="toggle">
            <input
              type="checkbox"
              checked={!!layer.override}
              disabled={layer.kind !== 'text' && layer.kind !== 'image'}
              onChange={(e) =>
                s.patchLayer(layer.id, {
                  override: e.target.checked ? (layer.kind === 'image' ? 'image' : 'text') : undefined,
                } as Partial<Layer>)
              }
            />
            <span>
              <b>카드마다 다르게</b>
              <em>
                {layer.kind === 'text' || layer.kind === 'image'
                  ? '켜면 카드별로 값을 넣을 수 있습니다'
                  : '글자·이미지 레이어만 가능합니다'}
              </em>
            </span>
          </label>

          {/* 3) 공통 속성 */}
          <h4>
            모양
            <span className="allcards">모든 카드 공통</span>
          </h4>
          <Txt label="이름" value={layer.name} onChange={(v) => s.patchLayer(layer.id, { name: v }, `nm:${layer.id}`)} />
          {layer.kind === 'text' && <TextProps l={layer} />}
          {layer.kind === 'image' && <ImageProps l={layer} />}
          {layer.kind === 'rect' && <RectProps l={layer} />}
          {layer.kind === 'gradient' && <GradProps l={layer} />}

          <div className="rowbtn">
            <button onClick={() => s.moveLayer(layer.id, 1)}>앞으로</button>
            <button onClick={() => s.moveLayer(layer.id, -1)}>뒤로</button>
            <button className="danger" onClick={() => s.removeLayer(layer.id)}>
              삭제
            </button>
          </div>
        </>
      )}
    </aside>
  )
}

/**
 * 조각 규격 — 크기·모양·도련, 그리고 종이에 어떻게 깔지.
 *
 * 자주 건드리는 게 아니라 접어둔다. 그래도 «지금 63×88 이다» 는 늘 보여야 해서
 * 접힌 상태의 제목에 규격을 적어둔다.
 */
function PieceSetup() {
  const s = useStore()
  const c = s.component()
  const d = s.deck()
  // 조판과 같은 계산을 쓴다 — 규칙이 두 벌이면 «미리보기와 인쇄가 다르다» 가 생긴다
  const g = layout(c.size, d.sheet)
  const circle = c.size.shape === 'circle'

  return (
    <details className="setup">
      <summary>
        조각
        <span className="allcards">
          {circle ? `지름 ${c.size.w}` : `${c.size.w} × ${c.size.h}`} mm
        </span>
      </summary>

      <label className="f">
        <span>규격</span>
        <select
          value=""
          onChange={(e) => {
            const i = Number(e.target.value)
            if (Number.isNaN(i) || !PIECE_PRESETS[i]) return
            s.patchSize({ ...PIECE_PRESETS[i]!.size })
          }}
        >
          <option value="">직접 입력</option>
          {PIECE_PRESETS.map((x, i) => (
            <option key={x.name} value={i}>
              {x.name}
            </option>
          ))}
        </select>
      </label>

      <label className="f">
        <span>모양</span>
        <select
          value={c.size.shape}
          onChange={(e) => s.patchSize({ shape: e.target.value as 'rect' | 'circle' })}
        >
          <option value="rect">네모</option>
          <option value="circle">원</option>
        </select>
      </label>

      {circle ? (
        <Num label="지름" value={c.size.w} min={5} onChange={(v) => s.patchSize({ w: v })} />
      ) : (
        <div className="grid2">
          <Num label="가로" value={c.size.w} min={5} onChange={(v) => s.patchSize({ w: v })} />
          <Num label="세로" value={c.size.h} min={5} onChange={(v) => s.patchSize({ h: v })} />
        </div>
      )}
      {/* 도련도 안전 여백도 여기 없다.
          도련은 인쇄물의 속성이라 «인쇄» 아래에 있고, 안전선은 판의 크기가 곧
          카드의 크기라 알려주는 게 없어서 없앴다 (끌 때만 여백 자리에 붙는다). */}

      <h5>뒷면</h5>
      <label className="f">
        <span>쓰기</span>
        <select
          value={d.back ?? ''}
          onChange={(e) => s.setBack(e.target.value === '' ? undefined : e.target.value)}
        >
          <option value="">없음 (단면)</option>
          {d.back && <option value={d.back}>{s.project.components[d.back]?.name ?? '뒷면'}</option>}
          <option value="new">+ 새 뒷면 만들기</option>
          {/* 섞이는 덱은 뒷면이 같아야 한다 — 다른 덱 뒷면을 그대로 쓸 수 있게 */}
          {Object.values(s.project.components)
            .filter(
              (x) =>
                x.id !== d.component &&
                x.id !== d.back &&
                x.size.w === c.size.w &&
                x.size.h === c.size.h &&
                s.project.decks.some((k) => k.back === x.id)
            )
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} (같이 쓰기)
              </option>
            ))}
        </select>
      </label>
      {d.back && (
        <>
          <label className="f">
            <span>넘김</span>
            <select
              value={d.duplex === false ? 'long' : d.duplex}
              onChange={(e) => s.setDuplex(e.target.value as 'long' | 'short')}
            >
              <option value="long">긴 쪽으로 넘김</option>
              <option value="short">짧은 쪽으로 넘김</option>
            </select>
          </label>
          <p className="hint sm nopad">
            프린터 양면 설정과 맞춰야 앞뒤가 겹칩니다. 틀리면 뒷면이 좌우로 뒤집혀 나옵니다.
          </p>
        </>
      )}

      <h5>인쇄</h5>
      <label className="f">
        <span>종이</span>
        <select
          value={`${d.sheet.w}x${d.sheet.h}`}
          onChange={(e) => {
            const [w, h] = e.target.value.split('x').map(Number)
            s.patchSheet({ w: w!, h: h! })
          }}
        >
          <option value="210x297">A4 세로</option>
          <option value="297x210">A4 가로</option>
          <option value="215.9x279.4">Letter 세로</option>
          <option value="279.4x215.9">Letter 가로</option>
        </select>
      </label>

      {/* 도련은 카드가 아니라 **인쇄물** 의 속성이다. A4 에 9장 깔면 가운데엔 필요 없고,
          밀려 잘릴 수 있는 바깥 변에만 필요하다. 인쇄 미리보기에서도 바로 바꿀 수 있다.
          지금은 꺼져 있다 (`BLEED_ENABLED` 주석 참조) — 맞붙이기만 된다. */}
      {!BLEED_ENABLED && (
        <p className="hint sm nopad">
          조각끼리 <b>맞붙여</b> 깝니다 — 칼질 한 번에 두 장이 잘리고 종이도 적게 듭니다.
          도련(자를 때 밀려도 흰 테두리가 안 생기게 하는 여유분)은 다음 판에서 다시 켭니다.
        </p>
      )}
      {BLEED_ENABLED && (
      <>
      <label className="f col">
        <span>도련</span>
        <select
          value={d.sheet.bleedMode ?? 'none'}
          onChange={(e) => s.patchSheet({ bleedMode: e.target.value as 'none' | 'outer' | 'each' })}
        >
          <option value="none">없음 — 맞붙이기</option>
          <option value="outer">바깥 테두리만 — 집에서 자를 때</option>
          <option value="each">조각마다 — 인쇄소에 맡길 때</option>
        </select>
      </label>
      {(d.sheet.bleedMode ?? 'none') !== 'none' && (
        <Num
          label="도련 크기"
          value={d.sheet.bleed ?? 3}
          min={0}
          onChange={(v) => s.patchSheet({ bleed: v })}
        />
      )}
      <p className="hint sm nopad">
        {(d.sheet.bleedMode ?? 'none') === 'none'
          ? '조각끼리 붙여 깝니다. 사이에 도련이 없어 칼질 한 번에 두 장이 잘리고, 종이도 적게 듭니다. 대신 자르는 위치가 밀리면 옆 조각이 조금 묻어납니다.'
          : (d.sheet.bleedMode ?? 'none') === 'outer'
            ? '맞붙이되 깔린 덩어리의 바깥 네 변에만 붙입니다. 안쪽 이음매는 이웃 조각이 도련 노릇을 하므로 그대로 두고, 바깥으로 밀려 잘릴 때만 흰 테두리가 생기니 거기만 막습니다.'
            : '조각마다 사방에 붙이고 그만큼 띄웁니다. 낱장으로 맡길 때. 한 장에 들어가는 수가 줄어듭니다.'}
      </p>
      </>
      )}
      <p className="hint sm nopad">
        <b>
          한 장에 {g.cols} × {g.rows} = {g.cols * g.rows}개
        </b>
        {' '}
        ({d.sheet.w} × {d.sheet.h}mm, 여백 {d.sheet.margin}mm)
      </p>
    </details>
  )
}

/**
 * 레이어 목록 — 끌어서 순서 바꾸기.
 *
 * 화면은 «위가 앞» 이라 배열을 뒤집어 보여준다.
 * 순서를 저장할 때 다시 뒤집는다 — 이 변환을 한 곳에만 두는 게 중요하다.
 */
function LayerList() {
  const s = useStore()
  const c = s.component()
  const shown = [...c.layers].reverse() // 위 = 앞
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [after, setAfter] = useState(false)

  const drop = () => {
    if (!dragId || !overId || dragId === overId) {
      setDragId(null)
      setOverId(null)
      return
    }
    const ids = shown.map((l) => l.id).filter((id) => id !== dragId)
    const at = ids.indexOf(overId)
    ids.splice(at + (after ? 1 : 0), 0, dragId)
    s.setLayerOrder([...ids].reverse()) // 화면 순서 -> 배열 순서
    setDragId(null)
    setOverId(null)
  }

  return (
    <div className="layers" onDragEnd={() => (setDragId(null), setOverId(null))}>
      {shown.map((l) => (
        <div
          key={l.id}
          draggable
          className={
            `ly${s.layerId === l.id ? ' on' : ''}` +
            `${dragId === l.id ? ' dragging' : ''}` +
            `${overId === l.id ? (after ? ' drop-after' : ' drop-before') : ''}`
          }
          onClick={() => s.selectLayer(l.id)}
          onDragStart={(e) => {
            setDragId(l.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragOver={(e) => {
            e.preventDefault()
            if (!dragId || dragId === l.id) return
            const r = e.currentTarget.getBoundingClientRect()
            setOverId(l.id)
            setAfter(e.clientY > r.top + r.height / 2)
          }}
          onDrop={(e) => {
            e.preventDefault()
            drop()
          }}
        >
          <span className="grip" title="끌어서 순서 바꾸기">⠿</span>
          <span className="ico">{ICON[l.kind]}</span>
          <span className="nm">{l.name}</span>
          {l.override && <span className="badge">카드마다</span>}
          <button
            className="eye"
            title={l.hidden ? '보이기' : '숨기기'}
            onClick={(e) => {
              e.stopPropagation()
              s.patchLayer(l.id, { hidden: !l.hidden })
            }}
          >
            {l.hidden ? '○' : '◉'}
          </button>
          <button
            className="del"
            title="레이어 삭제"
            onClick={(e) => {
              e.stopPropagation()
              s.removeLayer(l.id)
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}

/** 선택한 레이어가 «카드마다 다르게» 일 때, 지금 카드의 값을 고치는 자리 */
function InstanceValue({ layer }: { layer: Layer }) {
  const s = useStore()
  const inst = s.instance()!
  const n = s.deck().instances.findIndex((i) => i.id === inst.id) + 1

  const pick = async (f: File) => {
    const meta = await putAsset(f)
    await warmUrls([meta.id])
    s.setValue(inst.id, layer.id, meta.id)
  }

  return (
    <div className="instval">
      <h4>
        이 카드의 {layer.name}
        <span className="only">카드 {n} 에만</span>
      </h4>
      {layer.override === 'image' ? (
        <ImagePicker
          assetId={inst.values[layer.id]}
          onPick={pick}
          onClear={() => s.setValue(inst.id, layer.id, '')}
          hint="클릭하거나 캔버스에 끌어다 놓기"
        />
      ) : (
        <textarea
          className="big"
          rows={layer.h > 14 ? 5 : 2}
          value={inst.values[layer.id] ?? ''}
          placeholder="이 카드에 들어갈 내용"
          onChange={(e) => s.setValue(inst.id, layer.id, e.target.value)}
        />
      )}
    </div>
  )
}

/* ── 종류별 공통 속성 ────────────────────────────────── */

const SWATCHES = ['#571026', '#7D1F38', '#B3893A', '#D8B976', '#C9738C', '#2E232A', '#FFFDFA']

/**
 * 글꼴 한 줄.
 *
 * 이름은 **다 치고 나서** 반영한다. 글자 하나 칠 때마다 반영하면 그때마다
 * 글꼴을 브라우저에 다시 달고(파일 전체를 다시 읽는다) 되돌리기 기록도 쌓인다.
 * 게다가 «P» 만 친 순간의 이름으로 중복 검사가 돌아 엉뚱한 번호가 붙는다.
 */
function FontItem({ f }: { f: FontMeta }) {
  const s = useStore()
  const [draft, setDraft] = useState(f.family)
  const commit = async () => {
    if (draft.trim() === f.family) return
    const next = await renameFont(f.id, draft)
    if (next !== null) {
      s.renameFontRef(f.id, next)
      setDraft(next)
    }
  }
  return (
    <div className="fitem">
      {/* 견본을 실제 그 글꼴로 보여준다 — 이름만 봐서는 뭔지 모른다 */}
      <span className="sample" style={{ fontFamily: fontStack(f.family) }}>
        가나다 AaBb 123
      </span>
      <input
        className="fname"
        value={draft}
        title={`${f.name} · ${Math.round(f.size / 1024)}KB`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setDraft(f.family)
        }}
      />
      <button
        className="del"
        title="이 글꼴을 지웁니다. 쓰던 글자는 기본 글꼴로 돌아갑니다."
        onClick={async () => {
          if (!confirm(`«${f.family}» 을 지웁니다. 이 글꼴을 쓰던 글자는 기본 글꼴로 돌아갑니다.`)) return
          await removeFont(f.id)
          s.removeFont(f.id)
        }}
      >
        ✕
      </button>
    </div>
  )
}

/**
 * 글꼴 — 사용자가 직접 넣는다.
 *
 * 파일은 이 브라우저(IndexedDB)에 남고 프로젝트 파일에는 «무엇을 쓰는지» 만 적힌다.
 * 그래서 다른 컴퓨터에서 열면 글꼴이 없을 수 있고, 그때 여기서 알려준다.
 */
function FontSetup() {
  const s = useStore()
  useSyncExternalStore(subscribeFonts, fontsVersion)
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const here = fonts()
  const refs = s.project.fonts ?? []
  const missing = refs.filter((r) => !hasFont(r.id))

  const add = async (f: File) => {
    setBusy(true)
    setErr(null)
    try {
      const meta = await importFont(f)
      s.addFont({ id: meta.id, family: meta.family, name: meta.name })
    } catch {
      // 글꼴이 아닌 파일이거나 브라우저가 못 읽는 형식이다
      setErr(`«${f.name}» 을 글꼴로 읽지 못했습니다. ttf · otf · woff · woff2 를 넣어주세요.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="setup">
      <summary>
        글꼴
        <span className="allcards">{here.length ? `${here.length}개` : '기본만'}</span>
      </summary>

      {here.length > 0 && (
        <div className="fontlist">
          {here.map((f) => (
            <FontItem key={f.id} f={f} />
          ))}
        </div>
      )}

      <div className="rowbtn tight">
        <button disabled={busy} onClick={() => file.current?.click()}>
          {busy ? '읽는 중…' : '+ 글꼴 불러오기'}
        </button>
      </div>
      <input
        ref={file}
        type="file"
        accept=".ttf,.otf,.woff,.woff2,font/*"
        multiple
        hidden
        onChange={async (e) => {
          const list = [...(e.target.files ?? [])]
          e.target.value = ''
          for (const f of list) await add(f)
        }}
      />

      {err && <p className="hint sm nopad warn">{err}</p>}
      {missing.length > 0 && (
        <p className="hint sm nopad warn">
          이 프로젝트가 쓰는 글꼴 {missing.length}개가 이 브라우저에 없습니다 —{' '}
          {missing.map((m) => m.name).join(', ')}. 같은 파일을 불러오면 그대로 붙습니다.
        </p>
      )}
      <p className="hint sm nopad">
        글꼴 파일은 <b>이 브라우저에</b> 저장됩니다. 프로젝트 파일에는 이름만 적히므로,
        다른 컴퓨터에서 열 때는 글꼴도 같이 옮겨야 합니다. 인쇄하면 PDF 에 글자가 그대로 박힙니다 —
        배포용이라면 글꼴의 <b>내장(embedding) 허용 여부</b>를 확인하세요.
      </p>
    </details>
  )
}

function TextProps({ l }: { l: TextLayer }) {
  const s = useStore()
  const p = (v: Partial<TextLayer>, k?: string) => s.patchLayer(l.id, v as Partial<Layer>, k)
  return (
    <>
      {!l.override && (
        <label className="f col">
          <span>문구</span>
          <textarea value={l.text ?? ''} onChange={(e) => p({ text: e.target.value }, `t:${l.id}`)} />
        </label>
      )}
      <label className="f">
        <span>글꼴</span>
        <select value={l.font ?? 'var(--hd-sans)'} onChange={(e) => p({ font: e.target.value })}>
          <option value="var(--hd-sans)">고딕</option>
          <option value="var(--hd-serif)">명조</option>
          {fonts().map((f) => (
            <option key={f.id} value={f.family}>
              {f.family}
            </option>
          ))}
          {/* 프로젝트가 가리키는데 이 브라우저엔 없는 글꼴. 목록에서 빼버리면
              고르지도 못한 채 조용히 대체 글꼴로 나간다. 남겨서 보이게 둔다. */}
          {l.font && !l.font.startsWith('var(') && !fonts().some((f) => f.family === l.font) && (
            <option value={l.font}>{l.font} (없음)</option>
          )}
        </select>
      </label>
      <div className="grid2">
        <Num label="크기" value={l.size} min={1} onChange={(v) => p({ size: v }, `sz:${l.id}`)} />
        <Num label="굵기" value={l.weight} min={100} step={100} onChange={(v) => p({ weight: v }, `w:${l.id}`)} />
      </div>
      <Color label="색" value={l.color} onChange={(v) => p({ color: v }, `c:${l.id}`)} />
      <div className="sw">
        {SWATCHES.map((c) => (
          <button key={c} style={{ background: c }} onClick={() => p({ color: c })} />
        ))}
      </div>
      <div className="grid2">
        <label className="f">
          <span>가로</span>
          <select value={l.align ?? 'center'} onChange={(e) => p({ align: e.target.value as never })}>
            <option value="left">왼쪽</option>
            <option value="center">가운데</option>
            <option value="right">오른쪽</option>
          </select>
        </label>
        <label className="f">
          <span>세로</span>
          <select value={l.valign ?? 'middle'} onChange={(e) => p({ valign: e.target.value as never })}>
            <option value="top">위</option>
            <option value="middle">가운데</option>
            <option value="bottom">아래</option>
          </select>
        </label>
      </div>
      <label className="toggle sm">
        <input type="checkbox" checked={!!l.shrink} onChange={(e) => p({ shrink: e.target.checked })} />
        <span>넘치면 글자 줄이기</span>
      </label>
    </>
  )
}

function ImageProps({ l }: { l: ImageLayer }) {
  const s = useStore()
  const p = (v: Partial<ImageLayer>, k?: string) => s.patchLayer(l.id, v as Partial<Layer>, k)

  const pick = async (f: File) => {
    const meta = await putAsset(f)
    await warmUrls([meta.id])
    p({ asset: meta.id })
  }

  return (
    <>
      {!l.override && (
        <ImagePicker
          assetId={l.asset}
          onPick={pick}
          onClear={() => p({ asset: undefined })}
          hint="클릭하거나 캔버스에 끌어다 놓기"
        />
      )}
      <label className="f">
        <span>맞춤</span>
        <select value={l.fit ?? 'cover'} onChange={(e) => p({ fit: e.target.value as never })}>
          <option value="cover">꽉 채우기</option>
          <option value="contain">안에 맞추기</option>
          <option value="fill">늘려 채우기 (비율 무시)</option>
        </select>
      </label>
      <Txt label="위치" value={l.position} placeholder="center 35%" onChange={(v) => p({ position: v }, `p:${l.id}`)} />
      <Num label="둥글기" value={l.radius} min={0} onChange={(v) => p({ radius: v }, `r:${l.id}`)} />
    </>
  )
}

function RectProps({ l }: { l: RectLayer }) {
  const s = useStore()
  const p = (v: Partial<RectLayer>, k?: string) => s.patchLayer(l.id, v as Partial<Layer>, k)
  return (
    <>
      <Color label="채우기" value={l.fill} placeholder="없음" onChange={(v) => p({ fill: v }, `f:${l.id}`)} />
      <Color label="선 색" value={l.stroke} placeholder="없음" onChange={(v) => p({ stroke: v }, `s:${l.id}`)} />
      <Num label="선 굵기" value={l.strokeWidth} min={0} step={0.1} onChange={(v) => p({ strokeWidth: v }, `sw:${l.id}`)} />
      <Num label="둥글기" value={l.radius} min={0} onChange={(v) => p({ radius: v }, `r:${l.id}`)} />
    </>
  )
}

function GradProps({ l }: { l: GradientLayer }) {
  const s = useStore()
  const p = (v: Partial<GradientLayer>, k?: string) => s.patchLayer(l.id, v as Partial<Layer>, k)
  const stops = l.stops ?? []
  // 지금 값으로 그늘이 그려지는지. 안 그려지면 «화면에서 사라진» 이유를 알려줘야 한다.
  const css = gradientCss(stops, l.direction)
  const filled = stops.filter((x) => x.trim())
  return (
    <>
      <Txt label="방향" value={l.direction} placeholder="to bottom" onChange={(v) => p({ direction: v }, `d:${l.id}`)} />
      <label className="f col">
        <span>색 단계 (한 줄에 하나)</span>
        {/* 빈 줄을 지우지 않는다. 예전에는 `filter(Boolean)` 로 걸러내는 바람에
            Enter 를 치는 순간 그 줄이 사라져 단계를 추가할 수가 없었다.
            빈 줄은 그릴 때만 무시한다. */}
        <textarea
          value={stops.join('\n')}
          onChange={(e) => p({ stops: e.target.value.split('\n') }, `g:${l.id}`)}
        />
      </label>
      {!css && (
        <p className="hint sm nopad warn">
          {filled.length === 0
            ? '색 단계가 비어 있어 그늘이 그려지지 않습니다.'
            : '지금 값으로는 그늘을 그릴 수 없습니다 — 방향이나 색 표기를 확인하세요. 예: 방향 «to bottom», 색 «rgba(0,0,0,.6) 40%»'}
        </p>
      )}
      {/* 둥근 이미지 위에 얹을 때 그늘 모서리가 튀어나오지 않게 한다 */}
      <Num label="둥글기" value={l.radius} min={0} onChange={(v) => p({ radius: v }, `r:${l.id}`)} />
    </>
  )
}
