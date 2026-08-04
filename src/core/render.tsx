/**
 * 컴포넌트 + 인스턴스 -> DOM.
 *
 * [중요] 편집기 화면과 인쇄가 **이 파일 하나**를 같이 쓴다.
 * 렌더 코드가 두 벌이면 «화면에선 이런데 PDF 는 저렇다» 가 반드시 생긴다.
 *
 * 단위는 전부 mm. 브라우저가 mm 를 픽셀로 바꿔주므로 우리는 환산하지 않는다.
 */

import type { CSSProperties, ReactElement, ReactNode } from 'react'
import {
  type Component,
  type Instance,
  type Keyword,
  type Layer,
  resolveAsset,
  resolveText,
} from './model.ts'

const mm = (v: number): string => `${v}mm`

/**
 * 편집할 때의 조각 크기 = **재단 크기 그대로**.
 *
 * 도련은 판에 포함되지 않는다. 63×88 카드를 만들면 63×88 을 편집한다.
 * 도련이 필요한 건 내보낼 때뿐이라 `expandForBleed` 가 그때 만들어낸다.
 */
export function fullSize(c: Component): { w: number; h: number } {
  return { w: c.size.w, h: c.size.h }
}

/** 어느 변에 도련을 붙일지. 안쪽 이음매는 이웃 조각이 막아주므로 안 붙인다. */
export interface Edges {
  left: boolean
  top: boolean
  right: boolean
  bottom: boolean
}

export const NO_EDGES: Edges = { left: false, top: false, right: false, bottom: false }
export const edgesKey = (e: Edges): string =>
  `${e.left ? 1 : 0}${e.top ? 1 : 0}${e.right ? 1 : 0}${e.bottom ? 1 : 0}`

/**
 * 인쇄용 — 지정한 변에만 도련을 붙인 컴포넌트를 만든다.
 *
 * **도련은 카드의 속성이 아니다.** 편집할 때는 63×88 그 자체이고, 종이에 깔 때
 * «자르다 밀릴 수 있는 변» 에만 여유분을 만들어낸다. 그래서 붙일 변을 밖에서 받는다
 * (`impose` 가 깔린 덩어리의 바깥 변을 계산해 넘긴다).
 *
 * 붙이는 방법은 **그 변에 닿아 있던 레이어를 그 방향으로 늘리는 것**이다.
 * 배경 그림을 가장자리에 딱 맞춰 놓았다면 자동으로 도련까지 채워진다 —
 * 사용자가 69×94 를 의식할 일이 없다. 닿지 않은 레이어(글자 등)는
 * 위치만 옮겨지고 크기는 그대로다. 원본은 건드리지 않는다.
 */
export function expandForBleed(c: Component, bleed: number, edges: Edges): Component {
  const b = Math.max(0, bleed)
  if (b <= 0 || (!edges.left && !edges.top && !edges.right && !edges.bottom)) return c
  const dl = edges.left ? b : 0
  const dt = edges.top ? b : 0
  const dr = edges.right ? b : 0
  const db = edges.bottom ? b : 0
  const EPS = 0.01 // mm. 끌어다 놓은 값이라 딱 0 이 아닐 수 있다
  return {
    ...c,
    size: { ...c.size, w: c.size.w + dl + dr, h: c.size.h + dt + db },
    layers: c.layers.map((l) => {
      const left = dl > 0 && l.x <= EPS
      const top = dt > 0 && l.y <= EPS
      const right = dr > 0 && l.x + l.w >= c.size.w - EPS
      const bottom = db > 0 && l.y + l.h >= c.size.h - EPS
      return {
        ...l,
        x: l.x + dl - (left ? dl : 0),
        y: l.y + dt - (top ? dt : 0),
        w: l.w + (left ? dl : 0) + (right ? dr : 0),
        h: l.h + (top ? dt : 0) + (bottom ? db : 0),
      }
    }),
  }
}

/**
 * 그늘의 CSS.
 *
 * **여기가 방어적이어야 하는 이유**: 방향과 색 단계는 자유 입력이라 타이핑 도중에
 * 반드시 «아직 말이 안 되는 값» 을 거친다 (`to b`, 빈 줄, 색 하나만 남은 상태).
 * CSS 는 `linear-gradient` 가 조금이라도 어긋나면 **선언 전체를 버린다** —
 * 그늘이 옅어지는 게 아니라 **통째로 안 그려진다.** 고치는 중에 화면에서
 * 사라지면 뭘 잘못 쳤는지도 알 수 없다. 그래서 알아들을 수 있는 데까지 살려 그린다.
 *
 * 못 살리면 `undefined` 를 돌려준다 (그 레이어만 안 그려지고 나머지는 멀쩡하다).
 */
export function gradientCss(stops: string[], direction?: string): string | undefined {
  const list = stops.map((s) => s.trim()).filter(Boolean)
  if (list.length === 0) return undefined
  // 단계가 하나면 CSS 로는 그늘이 될 수 없다. 같은 색을 두 번 써서 단색으로 그린다.
  const parts = list.length === 1 ? [list[0]!, list[0]!] : list
  const dir = (direction ?? '').trim() || 'to bottom'

  const css = (d: string) => `linear-gradient(${d}, ${parts.join(', ')})`
  const okay = (v: string) =>
    typeof CSS === 'undefined' || !CSS.supports ? true : CSS.supports('background-image', v)

  if (okay(css(dir))) return css(dir)
  // 방향만 이상한 경우가 대부분이다 (타이핑 중). 기본 방향으로 되살려 본다.
  if (okay(css('to bottom'))) return css('to bottom')
  return undefined
}

/**
 * 글자 레이어의 `font` 를 CSS 글꼴 목록으로.
 *
 * 저장된 값은 **글꼴 이름 하나**다 (`Pretendard`). 이름에 공백이나 한글이 들어가면
 * 따옴표 없이는 CSS 가 못 알아듣고, 그 글꼴이 없을 때 기댈 곳도 있어야 한다.
 * 기존 프로젝트가 쓰던 `var(--hd-sans)` 같은 값은 그대로 통과시킨다.
 */
export function fontStack(font?: string): string {
  const f = (font ?? '').trim()
  if (!f) return 'var(--hd-sans)'
  if (f.startsWith('var(') || f.includes(',') || f.includes('"')) return f
  return `"${f}", var(--hd-sans)`
}

function boxStyle(l: Layer): CSSProperties {
  return {
    position: 'absolute',
    left: mm(l.x),
    top: mm(l.y),
    width: mm(l.w),
    height: mm(l.h),
    opacity: l.opacity ?? 1,
  }
}

export interface RenderOpts {
  /** 에셋 id -> 화면에 쓸 URL (blob: 또는 data:) */
  assetUrl: (id: string) => string | undefined
  /** 카드 글에서 다르게 그릴 낱말들 */
  keywords?: Keyword[]
}

/** 정규식에서 특별한 뜻을 갖는 글자를 그냥 글자로 만든다 */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * ── 칩 손잡이 ──────────────────────────────────────────────
 *
 * **모든 값의 단위는 «본문 글씨 크기(em)» 다.** 칩 자신의 글씨가 아니다.
 * 그래서 `size` 를 줄여도 **여백은 그대로 남는다** — 내보낼 때 `÷ size` 로
 * 환산해 넣기 때문이다 (아래 `outer()`).
 *
 * 왜 이렇게까지 하나. 두 가지가 사람을 헷갈리게 만든다:
 *
 * **1. `em` 은 그 요소 «자신의» 글씨 기준이다.**
 * `font-size: .8em` 인 칩에 `padding: .4em` 을 주면 실제 여백은 본문 기준 `.32em` 이다.
 * 글씨를 줄이면 여백·모서리가 **같이** 줄어든다 — 크기만 줄이고 여백은 두는 게
 * 구조적으로 불가능해진다.
 *
 * **2. `line-height` 로 높이를 만들면 위아래가 대칭으로 줄지 않는다.**
 * `line-height` 가 만드는 여백(half-leading)은 위아래에 정확히 반씩 붙는다.
 * 그런데 **글자상자 안에서 글리프는 가운데 있지 않다** — 상자는 글꼴의
 * ascent+descent 로 정해지고 글자는 밑선 위에 앉으므로, 처음부터
 * «글자 윗변~칩 윗변» 과 «글자 아랫변~칩 아랫변» 이 다르다.
 * 거기서 높이를 줄이면 양쪽에서 똑같이 떼어가는데 **원래 좁던 쪽이 먼저 0에 닿는다.**
 * 그래서 «위가 먼저 줄어든다» 로 보이고, 글꼴을 바꾸면 어느 쪽인지도 바뀐다.
 *
 * 그래서 높이는 `line-height` 가 아니라 **위아래 여백으로 직접** 만든다
 * (`line-height: 1` 로 두면 글자상자 = 글씨 크기라 계산이 예측 가능해진다).
 * 글꼴마다 다른 비대칭은 `padTop`/`padBottom` 을 따로 두어 눈으로 맞춘다 —
 * 한 값으로는 어떤 글꼴에서도 맞출 수 없다.
 *
 * ⚠️ **줄간격을 밀지 않으려면** `size + padTop + padBottom < 본문 줄간격(보통 1.4)`.
 */
const CHIP_KNOBS = {
  /** 칩 글씨 크기 */
  size: 0.8,
  /** 좌우 여백 */
  padX: 0.34,
  /** 위 여백 — 글자 위가 답답하면 키운다 */
  padTop: 0.15,
  /** 아래 여백 — 글꼴마다 밑선 아래 여유가 달라 위와 따로 둔다 */
  padBottom: 0.1,
  /** 모서리 둥글기. 칩 높이의 절반쯤이면 알약 모양 */
  radius: 0.28,
  /** 위아래 위치. 0 이면 칩 안 글자의 밑선이 본문 밑선에 앉는다 */
  shift: 0.1,
  /** 칩 안 글씨 굵기 */
  weight: 700,
}

/** 본문 기준 값을 칩 자신의 `em` 으로 환산 — 이게 «크기와 여백의 분리» 다 */
const outer = (v: number): string => `${+(v / CHIP_KNOBS.size).toFixed(4)}em`

/** 칩 전체 높이 (본문 기준). 이 값이 줄간격보다 작아야 줄이 안 밀린다 */
export const chipHeight = (): number => CHIP_KNOBS.size + CHIP_KNOBS.padTop + CHIP_KNOBS.padBottom

const CHIP: CSSProperties = {
  display: 'inline-block',
  fontSize: `${CHIP_KNOBS.size}em`,
  // 높이는 여백으로 만든다. 1 이면 글자상자가 곧 글씨 크기다.
  lineHeight: 1,
  padding: `${outer(CHIP_KNOBS.padTop)} ${outer(CHIP_KNOBS.padX)} ${outer(CHIP_KNOBS.padBottom)}`,
  borderRadius: outer(CHIP_KNOBS.radius),
  fontWeight: CHIP_KNOBS.weight,
  // 밑선을 기준으로 두고 손잡이만큼 올리고 내린다
  verticalAlign: outer(CHIP_KNOBS.shift),
  // 칩이 줄바꿈으로 두 동강 나면 상자가 깨진다
  whiteSpace: 'nowrap',
}

function keywordStyle(k: Keyword): CSSProperties {
  if (k.style === 'chip') {
    return { ...CHIP, background: k.bg ?? '#2E232A', color: k.color ?? '#FFFDFA' }
  }
  if (k.style === 'outline') {
    // 테두리를 `border` 로 그리면 상자가 그만큼 커져 채운 칩과 높이가 달라진다.
    // 안쪽 그림자로 그리면 크기가 그대로라 둘을 섞어 써도 줄이 안 흔들린다.
    const line = k.bg ?? k.color ?? '#2E232A'
    return { ...CHIP, color: k.color ?? line, boxShadow: `inset 0 0 0 .09em ${line}` }
  }
  if (k.style === 'bold') return { fontWeight: 800, color: k.color }
  return { color: k.color ?? '#7D1F38' }
}

/**
 * 글에서 키워드를 찾아 다르게 그린다.
 *
 * **긴 낱말부터 찾는다.** «돌진» 과 «연속 돌진» 이 둘 다 있으면 짧은 쪽이 먼저
 * 걸려서 긴 쪽이 영영 안 잡힌다.
 */
export function styleText(text: string, keywords?: Keyword[]): ReactNode {
  const list = (keywords ?? []).filter((k) => k.word.trim())
  if (list.length === 0 || !text) return text
  const sorted = [...list].sort((a, b) => b.word.trim().length - a.word.trim().length)
  const re = new RegExp(`(${sorted.map((k) => escapeRe(k.word.trim())).join('|')})`, 'g')
  // split 은 괄호로 잡은 부분을 결과에 끼워 넣는다 — 홀수 자리가 키워드다
  const parts = text.split(re)
  if (parts.length === 1) return text
  return parts.map((part, i) => {
    if (i % 2 === 0 || !part) return part
    const k = sorted.find((x) => x.word.trim() === part)
    return k ? (
      <span key={i} style={keywordStyle(k)}>
        {part}
      </span>
    ) : (
      part
    )
  })
}

function layerNode(l: Layer, inst: Instance | undefined, o: RenderOpts): ReactElement | null {
  if (l.hidden) return null
  const base = boxStyle(l)

  switch (l.kind) {
    case 'image': {
      const id = resolveAsset(l, inst)
      const url = id ? o.assetUrl(id) : undefined
      // [주의] background-size 에 'fill' 이라는 값은 없다. 비율을 무시하고 늘리려면
      // '100% 100%' 를 써야 한다. 'fill' 을 그대로 넣으면 조용히 무시된다.
      const size = l.fit === 'fill' ? '100% 100%' : (l.fit ?? 'cover')
      return (
        <div
          key={l.id}
          data-layer={l.id}
          style={{
            ...base,
            backgroundImage: url ? `url(${JSON.stringify(url)})` : undefined,
            backgroundSize: size,
            backgroundPosition: l.position ?? 'center',
            backgroundRepeat: 'no-repeat',
            borderRadius: l.radius ? mm(l.radius) : undefined,
            // 아직 그림이 없으면 자리만 흐리게 보여준다 (인쇄에는 안 나온다)
            outline: url ? undefined : '0.3mm dashed rgba(125,31,56,.25)',
          }}
        />
      )
    }

    case 'gradient':
      return (
        <div
          key={l.id}
          data-layer={l.id}
          style={{
            ...base,
            background: gradientCss(l.stops ?? [], l.direction),
            borderRadius: l.radius ? mm(l.radius) : undefined,
          }}
        />
      )

    case 'rect':
      return (
        <div
          key={l.id}
          data-layer={l.id}
          style={{
            ...base,
            background: l.fill ?? 'transparent',
            // 굵기 0 은 «선 없음» 이다. 0 을 그대로 넘기면 브라우저마다
            // 최소 1px 로 그리는 경우가 있어 0 이 안 먹는 것처럼 보인다.
            border:
              l.stroke && (l.strokeWidth ?? 0.3) > 0
                ? `${mm(l.strokeWidth ?? 0.3)} solid ${l.stroke}`
                : undefined,
            borderRadius: l.radius ? mm(l.radius) : undefined,
            boxSizing: 'border-box',
          }}
        />
      )

    case 'text': {
      const justify =
        l.valign === 'top' ? 'flex-start' : l.valign === 'bottom' ? 'flex-end' : 'center'
      return (
        <div
          key={l.id}
          data-layer={l.id}
          data-text="1"
          style={{
            ...base,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: justify,
            textAlign: l.align ?? 'center',
            fontFamily: fontStack(l.font),
            fontSize: `${l.size ?? 9}pt`,
            fontWeight: l.weight ?? 400,
            fontStyle: l.italic ? 'italic' : undefined,
            color: l.color ?? '#000',
            lineHeight: l.lineHeight ?? 1.4,
            letterSpacing: l.letterSpacing ? mm(l.letterSpacing) : undefined,
            textShadow: l.shadow,
            // 한글은 단어 단위로 끊는다. 이 한 줄이 조판 품질의 대부분이다.
            wordBreak: 'keep-all',
            overflowWrap: 'anywhere',
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
          }}
        >
          <span>{styleText(resolveText(l, inst), o.keywords)}</span>
        </div>
      )
    }
  }
}

/**
 * 조각 한 장. 편집기 캔버스도, 인쇄용 렌더도 이걸 쓴다.
 * 바깥에서 transform: scale() 로 확대/축소만 하면 된다.
 */
/**
 * 조각 한 장.
 *
 * **안내선은 그리지 않는다.** 판의 크기가 곧 카드의 크기이고 판의 테두리가 곧
 * 재단선이라, 그 위에 선을 하나 더 얹어도 알려주는 게 없다. 도련도 여기 없다 —
 * 인쇄할 때 종이에 깔면서 붙는다 (`impose`).
 */
export function Piece({
  component,
  instance,
  opts,
}: {
  component: Component
  instance?: Instance
  opts: RenderOpts
}): ReactElement {
  const f = fullSize(component)
  return (
    <div
      className="hd-piece"
      style={{
        position: 'relative',
        width: mm(f.w),
        height: mm(f.h),
        background: component.background,
        overflow: 'hidden',
        // 원형 조각은 화면에서도 원으로 보여준다
        borderRadius: component.size.shape === 'circle' ? '50%' : undefined,
      }}
    >
      {component.layers.map((l) => layerNode(l, instance, opts))}
    </div>
  )
}
