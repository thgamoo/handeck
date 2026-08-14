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
import type {
  Align,
  ImageLayer,
  Layer,
  MarkdownLayer,
  TextLayer,
  RectLayer,
  GradientLayer,
  VAlign,
} from '../core/model.ts'
import {
  BLEED_ENABLED,
  BOARD_PRESETS,
  checkDeckJson,
  deckToJson,
  PAGE_PRESETS,
  PIECE_PRESETS,
  SHEET_PRESETS,
  totalPieces,
  usedColors,
} from '../core/model.ts'
import { layout } from '../core/impose.ts'
import { tileBoard } from '../core/tile.ts'
import { planBook } from '../core/booklet.ts'
import { bodyFit } from '../core/rulebook.ts'
import { fontStack, gradientCss } from '../core/render.tsx'
import {
  fonts,
  fontsVersion,
  hasFont,
  importFont,
  removeFont,
  renameFont,
  setFontSynth,
  subscribeFonts,
  type FontMeta,
} from '../store/fonts.ts'
import { useStore } from '../store/project.ts'
import { assetUrl, putAsset, warmUrls } from '../store/assets.ts'
import { AlignBottom, AlignCenter, AlignLeft, AlignMiddle, AlignRight, AlignTop, type IconFn } from './icons.tsx'

const ICON: Record<Layer['kind'], string> = { image: '▣', text: 'T', rect: '▭', gradient: '▤', md: '¶' }

/** 정렬 단추 — 값 · 아이콘 · 설명 */
const HALIGN = [
  ['left', AlignLeft, '왼쪽'],
  ['center', AlignCenter, '가운데'],
  ['right', AlignRight, '오른쪽'],
] as const satisfies readonly (readonly [Align, IconFn, string])[]

const VALIGN = [
  ['top', AlignTop, '위'],
  ['middle', AlignMiddle, '가운데'],
  ['bottom', AlignBottom, '아래'],
] as const satisfies readonly (readonly [VAlign, IconFn, string])[]

/** CSS 표준 굵기. 숫자만 있으면 뭘 고르는지 모른다 */
const WEIGHTS = [
  { v: 300, label: '가늘게' },
  { v: 400, label: '보통' },
  { v: 500, label: '조금 굵게' },
  { v: 700, label: '굵게' },
  { v: 800, label: '더 굵게' },
  { v: 900, label: '아주 굵게' },
]

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
  const boardMode = s.mode === 'board'
  const bookMode = s.mode === 'book'
  const book = s.rulebook()

  return (
    <aside className="right">
      {/* 룰북에서는 «수량» 이 없다. 쪽을 두 장 찍을 일이 없기 때문이다 —
          대신 지금 몇 쪽인지와 앞뒤로 옮기는 단추를 둔다. 쪽은 순서가 곧 내용이다. */}
      {inst && bookMode && book && (
        <div className="instbar">
          <span>
            {book.pages.findIndex((i) => i.id === inst.id) + 1} / {book.pages.length}쪽
          </span>
          <button title="앞으로 (한 쪽 당기기)" onClick={() => s.movePage(inst.id, -1)}>
            ↑
          </button>
          <button title="뒤로 (한 쪽 밀기)" onClick={() => s.movePage(inst.id, 1)}>
            ↓
          </button>
        </div>
      )}
      {inst && !bookMode && (
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

      {/* 보드·룰북에는 뒷면이 없다 — 조각/덱 설정 대신 그쪽 설정을 보여준다.
          레이어 편집부터 아래는 완전히 같다 (셋 다 결국 틀 하나를 그리는 일이다) */}
      {boardMode ? <BoardSetup /> : bookMode ? <BookSetup /> : <PieceSetup />}
      {!boardMode && !bookMode && <DeckJsonEditor />}
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
        {/* 글이 흐르는 상자. 룰북에서 주로 쓰지만 카드 뒷면의 «규칙 요약» 에도 쓸모가 있다 */}
        <button onClick={() => s.addLayer('md')} title="소제목·목록·표가 섞인 글 덩어리 (마크다운)">
          + 본문
        </button>
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
              disabled={layer.kind === 'rect' || layer.kind === 'gradient'}
              onChange={(e) =>
                s.patchLayer(layer.id, {
                  override: e.target.checked ? (layer.kind === 'image' ? 'image' : 'text') : undefined,
                } as Partial<Layer>)
              }
            />
            <span>
              <b>{bookMode ? '쪽마다 다르게' : '카드마다 다르게'}</b>
              <em>
                {layer.kind === 'rect' || layer.kind === 'gradient'
                  ? '글자·본문·이미지 레이어만 가능합니다'
                  : bookMode
                    ? '켜면 쪽별로 값을 넣을 수 있습니다'
                    : '켜면 카드별로 값을 넣을 수 있습니다'}
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
          {layer.kind === 'md' && <MdProps l={layer} />}
          {layer.kind === 'image' && <ImageProps l={layer} />}
          {layer.kind === 'rect' && <RectProps l={layer} />}
          {layer.kind === 'gradient' && <GradProps l={layer} />}

          <div className="rowbtn">
            <button onClick={() => s.moveLayer(layer.id, 1)}>앞으로</button>
            <button onClick={() => s.moveLayer(layer.id, -1)}>뒤로</button>
            <button title="Ctrl+D" onClick={() => s.duplicateLayer(layer.id)}>
              복제
            </button>
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
/**
 * 보드 설정 — 판 크기 · 종이 · 앉히는 방식.
 *
 * 덱의 «조각» 패널과 자리가 같지만 내용이 다르다.
 * 여기서 답해야 하는 질문은 하나다 — **이 판을 어느 종이에 어떻게 앉히나.**
 */
function BoardSetup() {
  const s = useStore()
  const b = s.board()
  const c = s.component()
  if (!b) return null

  const plan = tileBoard(c.size, b.sheet, b)
  const tiled = (b.tiling ?? 'single') === 'tile'
  const matched = String(
    BOARD_PRESETS.findIndex((x) => x.size.w === c.size.w && x.size.h === c.size.h)
  ).replace('-1', '')

  return (
    <details className="setup" id="setup-board" open>
      <summary>
        보드
        <span className="allcards">
          {c.size.w} × {c.size.h} mm
        </span>
      </summary>

      <label className="f">
        <span>판 크기</span>
        <select
          value={matched}
          onChange={(e) => {
            const i = Number(e.target.value)
            if (Number.isNaN(i) || !BOARD_PRESETS[i]) return
            s.patchSize({ ...BOARD_PRESETS[i]!.size })
          }}
        >
          <option value="">자유 크기 — 아래에서 직접</option>
          {BOARD_PRESETS.map((x, i) => (
            <option key={x.name} value={i}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <div className="grid2">
        <Num label="가로" value={c.size.w} min={10} onChange={(v) => s.patchSize({ w: v })} />
        <Num label="세로" value={c.size.h} min={10} onChange={(v) => s.patchSize({ h: v })} />
      </div>

      <h5>인쇄</h5>
      <label className="f">
        <span>종이</span>
        <select
          value={`${b.sheet.w}x${b.sheet.h}`}
          onChange={(e) => {
            const [w, h] = e.target.value.split('x').map(Number)
            s.patchBoardSheet({ w: w!, h: h! })
          }}
        >
          {SHEET_PRESETS.map((x) => (
            <option key={x.name} value={`${x.w}x${x.h}`}>
              {x.name}
            </option>
          ))}
        </select>
      </label>

      {/* **판과 종이는 별개다.** A3 판을 A3 종이에 통째로 뽑을 수도, A4 여러 장에
          나눠 뽑아 이어 붙일 수도 있다. 집 프린터는 대개 A4 까지라 둘 다 필요하다. */}
      <label className="f">
        <span>앉히기</span>
        <select
          value={b.tiling ?? 'single'}
          onChange={(e) => s.patchBoard({ tiling: e.target.value as 'single' | 'tile' })}
        >
          <option value="single">한 장에 그대로</option>
          <option value="tile">나눠 뽑아 이어 붙이기</option>
        </select>
      </label>

      {tiled && (
        <>
          <Num
            label="겹침"
            value={b.overlap ?? 10}
            min={0}
            onChange={(v) => s.patchBoard({ overlap: v })}
          />
          <p className="hint sm nopad">
            이웃 장과 이만큼 겹쳐 찍습니다 — 풀칠할 자리입니다. 딱 맞게 자르면
            조금만 밀려도 흰 줄이 생기지만, 겹쳐 두면 위에 얹어 붙일 수 있습니다.
          </p>
        </>
      )}

      {/* 여백은 **나눠 뽑을 때만** 쓴다. 한 장에 그대로 뽑으면 판을 종이 가운데
          앉히므로 여백이 관여하지 않는다 — 관여하게 두면 종이와 같은 크기의 판이
          여백만큼 잘려 나간다. 그래서 그때는 칸 자체를 안 보여준다. */}
      {tiled && (
        <Num label="여백" value={b.sheet.margin} min={0} onChange={(v) => s.patchBoardSheet({ margin: v })} />
      )}

      <p className={`hint sm nopad${plan.overflow ? ' warn' : ''}`}>
        {plan.overflow
          ? `판이 종이보다 큽니다 — 이대로 뽑으면 사방이 고르게 잘립니다. 큰 종이를 고르거나 «나눠 뽑기» 로 바꾸세요.`
          : plan.pages.length > 1
            ? `종이 ${plan.rows}×${plan.cols} = ${plan.pages.length}장. 가로 ${Math.round(plan.overlapX * 10) / 10}mm · 세로 ${Math.round(plan.overlapY * 10) / 10}mm 씩 겹칩니다.`
            : plan.single
              ? `종이 한 장 가운데에 들어갑니다 (${b.sheet.w}×${b.sheet.h}mm).`
              : `종이 한 장에 가운데로 앉지만 여백(${b.sheet.margin}mm) 안쪽을 넘습니다 — «가장자리 없음» 으로 인쇄하세요.`}
      </p>

      <label className="f col">
        <span>메모</span>
        <textarea
          className="dnote"
          value={b.note ?? ''}
          placeholder="나중에 잊어버릴 이유 (예: 접는 판이라 가운데 이음매는 비워둔다)"
          onChange={(e) => s.setBoardNote(b.id, e.target.value)}
        />
      </label>
    </details>
  )
}

/**
 * 룰북 설정 — 쪽 크기 · 종이 · 제본.
 *
 * 여기서 답해야 하는 질문은 하나다 — **이걸 어떻게 묶나.**
 * 그 답이 종이에 쪽을 앉히는 방식을 통째로 정한다 (중철이면 한 면에 두 쪽).
 */
function BookSetup() {
  const s = useStore()
  const b = s.rulebook()
  const c = s.component()
  if (!b) return null

  const plan = planBook(c.size, b.sheet, b)
  const matched = String(
    PAGE_PRESETS.findIndex((x) => x.size.w === c.size.w && x.size.h === c.size.h)
  ).replace('-1', '')
  const over = b.pages.filter((pg) => bodyFit(c, pg)?.over).length

  return (
    <details className="setup" id="setup-book" open>
      <summary>
        룰북
        <span className="allcards">
          {c.size.w} × {c.size.h} mm · {b.pages.length}쪽
        </span>
      </summary>

      <label className="f">
        <span>쪽 크기</span>
        <select
          value={matched}
          onChange={(e) => {
            const preset = PAGE_PRESETS[Number(e.target.value)]
            if (!preset) return
            s.patchSize({ ...preset.size })
            // 쪽이 커지면 종이도 같이 커져야 한다. 안 맞추면 다음 인쇄에서
            // «두 쪽이 안 들어감» 경고부터 보게 된다.
            s.patchRulebookSheet({ w: preset.sheet.w, h: preset.sheet.h })
          }}
        >
          {matched === '' && <option value="">직접 입력</option>}
          {PAGE_PRESETS.map((x, i) => (
            <option key={x.name} value={i}>
              {x.name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid2">
        <Num label="폭" value={c.size.w} min={10} onChange={(v) => s.patchSize({ w: v })} />
        <Num label="높이" value={c.size.h} min={10} onChange={(v) => s.patchSize({ h: v })} />
      </div>

      <label className="f">
        <span>제본</span>
        <select
          value={b.binding ?? 'saddle'}
          onChange={(e) => s.patchRulebook({ binding: e.target.value as 'saddle' | 'staple' })}
        >
          <option value="saddle">접어서 중철 (한 면에 두 쪽)</option>
          <option value="staple">모서리 스테이플 (한 면에 한 쪽)</option>
        </select>
      </label>

      <label className="f">
        <span>종이</span>
        <select
          value={`${b.sheet.w}x${b.sheet.h}`}
          onChange={(e) => {
            const [w, h] = e.target.value.split('x').map(Number)
            s.patchRulebookSheet({ w: w!, h: h! })
          }}
        >
          {!SHEET_PRESETS.some((x) => x.w === b.sheet.w && x.h === b.sheet.h) && (
            <option value={`${b.sheet.w}x${b.sheet.h}`}>
              {b.sheet.w}×{b.sheet.h}mm
            </option>
          )}
          {SHEET_PRESETS.map((x) => (
            <option key={x.name} value={`${x.w}x${x.h}`}>
              {x.name}
            </option>
          ))}
        </select>
      </label>

      <label className="f">
        <span>넘김</span>
        <select
          value={b.duplex === false ? 'off' : (b.duplex ?? 'short')}
          onChange={(e) =>
            s.patchRulebook({
              duplex: e.target.value === 'off' ? false : (e.target.value as 'long' | 'short'),
            })
          }
        >
          <option value="short">양면 · 짧은 쪽</option>
          <option value="long">양면 · 긴 쪽</option>
          <option value="off">단면만</option>
        </select>
      </label>

      <p className={`hint sm nopad${plan.overflow ? ' warn' : ''}`}>
        {plan.overflow ? (
          <>
            ⚠ 쪽 {plan.perSide}개가 종이에 안 들어갑니다. 종이를 키우거나 제본을 바꾸세요.
          </>
        ) : (
          <>
            종이 <b>{plan.sheets.length}면</b>
            {plan.binding === 'saddle' && (
              <> · 접어서 {plan.sheets.length / (plan.duplex ? 2 : 1)}장</>
            )}
            {plan.padded > plan.count && <> · 백지 {plan.padded - plan.count}쪽</>}
          </>
        )}
      </p>
      {over > 0 && (
        <p className="hint sm nopad warn">
          ⚠ 본문이 넘치는 쪽이 <b>{over}쪽</b> 있습니다 — 왼쪽 목록에 «넘침» 으로 표시했습니다.
          넘친 글은 <b>종이에서 잘려 나갑니다.</b>
        </p>
      )}

      <label className="f col">
        <span>메모</span>
        <textarea
          className="dnote"
          value={b.note ?? ''}
          placeholder="«매끈한 종이(스노우지)에 뽑는다» 처럼 나중에 잊어버릴 것"
          onChange={(e) => s.setRulebookNote(b.id, e.target.value)}
        />
      </label>
    </details>
  )
}

function PieceSetup() {
  const s = useStore()
  const c = s.component()
  const d = s.deck()
  // 조판과 같은 계산을 쓴다 — 규칙이 두 벌이면 «미리보기와 인쇄가 다르다» 가 생긴다
  const g = layout(c.size, d.sheet)
  const circle = c.size.shape === 'circle'
  // 지금 크기와 똑같은 프리셋이 있으면 그걸 고른 것으로 보여준다
  const matched = String(
    PIECE_PRESETS.findIndex(
      (x) => x.size.w === c.size.w && x.size.h === c.size.h && x.size.shape === c.size.shape
    )
  ).replace('-1', '')

  return (
    <details className="setup" id="setup-piece">
      <summary>
        조각
        <span className="allcards">
          {circle ? `지름 ${c.size.w}` : `${c.size.w} × ${c.size.h}`} mm
        </span>
      </summary>

      {/* 지금 규격이 어느 프리셋인지 보여준다. 안 맞으면 «자유 크기» 다 —
          예전에는 늘 «직접 입력» 이라 지금 뭘 쓰는지 알 수 없었다. */}
      <label className="f">
        <span>규격</span>
        <select
          value={matched}
          onChange={(e) => {
            const i = Number(e.target.value)
            if (Number.isNaN(i) || !PIECE_PRESETS[i]) return
            s.patchSize({ ...PIECE_PRESETS[i]!.size })
          }}
        >
          <option value="">자유 크기 — 아래에서 직접</option>
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
          {SHEET_PRESETS.map((x) => (
            <option key={x.name} value={`${x.w}x${x.h}`}>
              {x.name}
            </option>
          ))}
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
      {/* 기대 장수 — 규칙 문서가 정한 수를 적어두면 실제와 어긋날 때 빨갛게 알려준다.
          **값을 넣을 자리가 없던 것이 문제였다.** 한 번 박히면 못 고쳐서
          «카드를 지웠는데 옛날 수가 계속 남는» 것처럼 보였다. */}
      <label className="f">
        <span>기대 장수</span>
        <input
          type="number"
          min={0}
          placeholder="안 씀"
          value={d.expect ?? ''}
          onChange={(e) =>
            s.setDeckExpect(d.id, e.target.value === '' ? undefined : Number(e.target.value))
          }
        />
      </label>
      <div className="rowbtn tight">
        <button
          disabled={d.expect === totalPieces(d)}
          title="지금 실제 장수를 기대 장수로 삼습니다"
          onClick={() => s.setDeckExpect(d.id, totalPieces(d))}
        >
          지금 수({totalPieces(d)})로 맞추기
        </button>
        <button disabled={d.expect === undefined} onClick={() => s.setDeckExpect(d.id, undefined)}>
          대조 끄기
        </button>
      </div>
      <p className="hint sm nopad">
        문서가 정한 장수를 적어두면 실제와 <b>어긋날 때 빨갛게</b> 알려줍니다 («16 / 48»).
        일부러 늘리거나 줄였다면 «지금 수로 맞추기» 를, 안 셀 거면 «대조 끄기» 를 누르세요.
      </p>

      {/* 규칙 문서에는 있지만 카드에는 안 적히는 이유들 — 나중에 반드시 잊어버린다 */}
      <label className="f col">
        <span>메모</span>
        <textarea
          className="dnote"
          value={d.note ?? ''}
          placeholder="이 덱에 대해 잊으면 안 되는 것 (예: 뒷면이 운명 카드와 같아야 한다)"
          onChange={(e) => s.setDeckNote(d.id, e.target.value)}
        />
      </label>

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
  const book = s.mode === 'book' ? s.rulebook() : undefined
  const n = book
    ? book.pages.findIndex((i) => i.id === inst.id) + 1
    : s.deck().instances.findIndex((i) => i.id === inst.id) + 1
  const unit = book ? '쪽' : '카드'
  // 룰북 본문은 문서 한 덩어리라 두 줄짜리 칸으로는 못 고친다.
  // 여기가 실질적으로 «원고를 쓰는 자리» 가 된다.
  const rows = layer.kind === 'md' ? 16 : layer.h > 14 ? 5 : 2

  const pick = async (f: File) => {
    const meta = await putAsset(f)
    await warmUrls([meta.id])
    s.setValue(inst.id, layer.id, meta.id)
  }

  return (
    <div className="instval">
      <h4>
        이 {unit}의 {layer.name}
        <span className="only">
          {unit} {n} 에만
        </span>
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
          rows={rows}
          value={inst.values[layer.id] ?? ''}
          placeholder={layer.kind === 'md' ? '## 소제목\n\n본문을 마크다운으로' : `이 ${unit}에 들어갈 내용`}
          onChange={(e) => s.setValue(inst.id, layer.id, e.target.value)}
        />
      )}
    </div>
  )
}

/* ── 종류별 공통 속성 ────────────────────────────────── */

const SWATCHES = ['#571026', '#7D1F38', '#B3893A', '#D8B976', '#C9738C', '#2E232A', '#FFFDFA']

/**
 * 덱 JSON — 구조를 통째로 주고받는다.
 *
 * **다른 프로젝트에서 레이어 구조를 그대로 가져오려고** 있다. 카드 한 종류를 잘 짜두면
 * 그 틀은 다음 게임에서도 쓸 만한데, 지금까지는 손으로 다시 그려야 했다.
 *
 * 붙여넣을 때 **덱과 틀의 id 는 그대로 두고 내용만 갈아끼운다** — 그래야 이 덱을
 * 가리키던 인쇄 묶음이 안 깨진다.
 */
function DeckJsonEditor() {
  const s = useStore()
  const deck = s.deck()
  const current = JSON.stringify(deckToJson(s.project, deck), null, 2)

  const [draft, setDraft] = useState<string | null>(null)
  const [withCards, setWithCards] = useState(true)
  const [msg, setMsg] = useState<{ bad?: boolean; text: string } | null>(null)
  const text = draft ?? current

  const apply = () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      setMsg({ bad: true, text: `JSON 을 읽지 못했습니다: ${e instanceof Error ? e.message : e}` })
      return
    }
    const r = checkDeckJson(parsed)
    if (!r.ok) {
      setMsg({ bad: true, text: r.why })
      return
    }
    s.applyDeckJson(deck.id, r.value, withCards)
    setDraft(null)
    setMsg({
      text: withCards
        ? '적용했습니다. 되돌리기(Ctrl+Z)로 돌아갈 수 있습니다.'
        : '틀만 적용했습니다. 카드의 «카드마다 다르게» 값은 레이어 id 로 묶여 있어, 레이어가 바뀌었다면 비어 보일 수 있습니다.',
    })
  }

  return (
    <details className="setup">
      <summary>
        JSON
        <span className="allcards">{deck.name}</span>
      </summary>

      <p className="hint sm nopad">
        이 덱의 <b>틀·레이어·카드</b>를 그대로 담은 JSON 입니다. 복사해서 다른 프로젝트에
        붙여넣으면 구조가 옮겨집니다. 덱 id 는 유지되므로 <b>프린트묶기는 안 깨집니다</b>.
      </p>

      <textarea
        className="jsonbox"
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setDraft(e.target.value)
          setMsg(null)
        }}
      />

      <label className="toggle sm">
        <input type="checkbox" checked={withCards} onChange={(e) => setWithCards(e.target.checked)} />
        <span>
          <b>카드 내용까지 가져오기</b>
          <em>끄면 틀(레이어)만 바뀌고 지금 카드가 남습니다</em>
        </span>
      </label>

      <div className="rowbtn tight">
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(current)
            setMsg({ text: '복사했습니다.' })
          }}
        >
          복사
        </button>
        <button className="go" disabled={draft === null} onClick={apply}>
          적용
        </button>
        <button
          disabled={draft === null}
          onClick={() => {
            setDraft(null)
            setMsg(null)
          }}
        >
          되돌림
        </button>
      </div>

      {msg && <p className={`hint sm nopad${msg.bad ? ' warn' : ''}`}>{msg.text}</p>}
      <p className="hint sm nopad">
        ⚠️ 그림은 안 들어갑니다 — 에셋 id 만 남으므로, 그림까지 옮기려면 «저장»(묶음)을 쓰세요.
      </p>
    </details>
  )
}

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
      {/* 글꼴 파일 하나에는 보통 굵기가 하나뿐이다. 흉내를 켜두면 굵기 조절이 먹는다.
          Regular·Bold 를 따로 넣었다면 꺼야 한다 — 안 그러면 Bold 에 또 얹혀 뭉개진다. */}
      <label className="fsynth" title="이 글꼴에 굵게를 흉내냅니다. 굵기 조절이 안 먹으면 켜세요. 진짜 Bold 파일을 따로 넣었다면 끄세요.">
        <input
          type="checkbox"
          checked={f.synth !== false}
          onChange={(e) => void setFontSynth(f.id, e.target.checked)}
        />
        굵게
      </label>
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
        <label className="f">
          <span>굵기</span>
          <select value={l.weight ?? 400} onChange={(e) => p({ weight: Number(e.target.value) })}>
            {WEIGHTS.map((w) => (
              <option key={w.v} value={w.v}>
                {w.v} {w.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {/* 정렬은 글꼴 바로 아래. 고르는 목록보다 **눌러서 바로 바뀌는** 편이 빠르고,
          지금 무엇이 켜져 있는지도 한눈에 보인다. */}
      <label className="f">
        <span>가로</span>
        <span className="seg">
          {HALIGN.map(([v, Icon, label]) => (
            <button
              key={v}
              type="button"
              title={label}
              aria-pressed={(l.align ?? 'center') === v}
              className={(l.align ?? 'center') === v ? 'on' : undefined}
              onClick={() => p({ align: v })}
            >
              <Icon />
            </button>
          ))}
        </span>
      </label>
      <label className="f">
        <span>세로</span>
        <span className="seg">
          {VALIGN.map(([v, Icon, label]) => (
            <button
              key={v}
              type="button"
              title={label}
              aria-pressed={(l.valign ?? 'middle') === v}
              className={(l.valign ?? 'middle') === v ? 'on' : undefined}
              onClick={() => p({ valign: v })}
            >
              <Icon />
            </button>
          ))}
        </span>
      </label>

      {/* 불러온 글꼴은 보통 굵기가 하나뿐이라, 흉내를 꺼두면 이 값이 안 먹는다 */}
      {l.font && !l.font.startsWith('var(') && fonts().find((f) => f.family === l.font)?.synth === false && (
        <p className="hint sm nopad">
          «{l.font}» 은 굵게 흉내가 꺼져 있어 굵기가 안 바뀝니다 — 위 «글꼴» 에서 켜세요.
        </p>
      )}
      <Color label="색" value={l.color} onChange={(v) => p({ color: v }, `c:${l.id}`)} />
      <div className="sw">
        {SWATCHES.map((c) => (
          <button key={c} style={{ background: c }} onClick={() => p({ color: c })} />
        ))}
      </div>
      <label className="toggle sm">
        <input type="checkbox" checked={!!l.shrink} onChange={(e) => p({ shrink: e.target.checked })} />
        <span>넘치면 글자 줄이기</span>
      </label>
    </>
  )
}

/**
 * 본문(마크다운) 속성.
 *
 * 손잡이가 적은 것이 요점이다. **크기 하나로 전체가 같이 줄고 늘어난다** —
 * 소제목·여백·표가 전부 본문 글씨 기준(em)이라 그렇다 (`render.tsx` 참조).
 * 쪽이 넘칠 때 사람이 만질 곳이 하나면 «어디를 건드려야 하지» 가 없어진다.
 */
function MdProps({ l }: { l: MarkdownLayer }) {
  const s = useStore()
  const p = (v: Partial<MarkdownLayer>, k?: string) => s.patchLayer(l.id, v as Partial<Layer>, k)
  return (
    <>
      {!l.override && (
        <label className="f col">
          <span>본문</span>
          <textarea
            rows={10}
            value={l.text ?? ''}
            placeholder="## 소제목&#10;&#10;본문. **굵게** · 목록 · 표 · 인용을 씁니다"
            onChange={(e) => p({ text: e.target.value }, `t:${l.id}`)}
          />
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
          {l.font && !l.font.startsWith('var(') && !fonts().some((f) => f.family === l.font) && (
            <option value={l.font}>{l.font} (없음)</option>
          )}
        </select>
      </label>
      <div className="grid2">
        <Num label="크기" value={l.size} min={3} step={0.5} onChange={(v) => p({ size: v }, `sz:${l.id}`)} />
        <Num
          label="줄간격"
          value={l.lineHeight ?? 1.5}
          min={1}
          step={0.05}
          onChange={(v) => p({ lineHeight: v }, `lh:${l.id}`)}
        />
      </div>
      <div className="grid2">
        <label className="f">
          <span>단</span>
          <select value={l.columns ?? 1} onChange={(e) => p({ columns: Number(e.target.value) })}>
            <option value={1}>한 단</option>
            <option value={2}>두 단</option>
            <option value={3}>세 단</option>
          </select>
        </label>
        <Num label="단 간격" value={l.gap ?? 6} min={0} step={0.5} onChange={(v) => p({ gap: v }, `gp:${l.id}`)} />
      </div>
      <Color label="색" value={l.color} onChange={(v) => p({ color: v }, `c:${l.id}`)} />
      <p className="hint sm nopad">
        <b># 소제목</b> · <b>- 목록</b> · <b>| 표 |</b> · <b>&gt; 인용</b> ·{' '}
        <b>**굵게**</b> 를 알아봅니다. 상자를 넘친 글은 <b>인쇄에서 잘립니다</b> —
        크기를 줄이거나 쪽을 나누세요.
      </p>
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
