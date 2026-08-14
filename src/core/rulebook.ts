/**
 * 원고(마크다운·JSON) → **룰북 템플릿.**
 *
 * 룰북에서 사람이 실제로 하는 일은 «글을 쓰는 것» 이지 «상자를 놓는 것» 이 아니다.
 * 그런데 편집기만 있으면 20쪽짜리 문서를 만들 때 상자를 20번 놓게 된다 —
 * 그건 이 도구가 없애려던 바로 그 루프다.
 *
 * 그래서 **원고를 통째로 받아 쪽을 나누고 틀을 만들어준다.** 규칙 문서는 어차피
 * 마크다운으로 쓰고 있고(`sub3/docs/rules/*.md`), 그게 그대로 입력이 된다.
 * 가져온 뒤에는 보통 프로젝트와 똑같다 — 끌어 옮기고 색을 바꾸면 20쪽이 같이 따라온다.
 *
 * ── 원고 규칙 ─────────────────────────────────────────────
 *   `---` 한 줄이 **쪽 나눔**이다 (「## 마다」를 골라도 된다)
 *   각 쪽의 **첫 헤딩이 그 쪽의 제목**이 되고, 나머지가 본문으로 흐른다
 *   `<!-- -->` 주석은 인쇄되지 않는다 — 원고에 남기는 메모 자리
 */

import { parseMarkdown, estimateLines } from './markdown.ts'
import {
  type Component,
  type Instance,
  type MarkdownLayer,
  type PieceSize,
  type Rulebook,
  type SheetSpec,
  type TextLayer,
  uid,
} from './model.ts'

export interface DocPage {
  title: string
  body: string
}

export interface RulebookDoc {
  title: string
  pages: DocPage[]
  /** 가져오기 화면에서 그대로 보여줄 말 */
  warnings: string[]
}

/** 어디서 쪽을 나눌지 */
export type SplitMode = 'hr' | 'h2'

const stripComments = (s: string): string => s.replace(/<!--[\s\S]*?-->/g, '')

/** 이 덩어리의 첫 헤딩을 뽑아 제목으로 쓰고 본문에서 뺀다 */
function splitTitle(chunk: string): DocPage {
  const lines = chunk.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    if (!l.trim()) continue
    const h = /^(#{1,3})\s+(.*)$/.exec(l.trim())
    if (h) {
      const rest = [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n')
      return { title: h[2]!.trim(), body: rest.trim() }
    }
    break // 첫 내용이 헤딩이 아니면 제목 없는 쪽이다
  }
  return { title: '', body: chunk.trim() }
}

/**
 * 원고를 읽는다. **마크다운과 JSON 을 둘 다 받는다** —
 * 앞이 `{` 나 `[` 면 JSON, 아니면 마크다운으로 본다 (파일 이름은 안 본다).
 */
export function parseRulebookSource(text: string, split: SplitMode = 'hr'): RulebookDoc {
  const src = stripComments(text).replace(/\r\n?/g, '\n')
  const head = src.trim()[0]
  if (head === '{' || head === '[') return fromJson(src)

  // 쪽 나눔. 표의 구분선(`|---|`)과 헷갈리지 않게 **`|` 가 없는 줄**만 본다
  const chunks =
    split === 'h2'
      ? src.split(/\n(?=##\s)/)
      : src.split(/\n\s*(?:-{3,}|\*{3,}|_{3,})\s*\n/)

  const pages = chunks
    .map((c) => c.trim())
    .filter(Boolean)
    .map(splitTitle)
    .filter((p) => p.title || p.body)

  const warnings: string[] = []
  if (pages.length === 0) warnings.push('원고에서 쪽을 하나도 찾지 못했습니다')
  if (split === 'hr' && pages.length === 1)
    warnings.push('`---` 로 나뉜 자리가 없어 한 쪽으로 들어갑니다 — 「## 마다」로 나눠보세요')

  // 첫 쪽의 제목을 룰북 이름으로 쓴다 (보통 표지의 `# 제목` 이다)
  return { title: pages[0]?.title || '룰북', pages, warnings }
}

function fromJson(src: string): RulebookDoc {
  const warnings: string[] = []
  let raw: unknown
  try {
    raw = JSON.parse(src)
  } catch (e) {
    return { title: '룰북', pages: [], warnings: [`JSON 을 읽지 못했습니다: ${e instanceof Error ? e.message : e}`] }
  }
  const obj = (Array.isArray(raw) ? { pages: raw } : raw) as {
    title?: string
    name?: string
    pages?: unknown[]
  }
  const list = Array.isArray(obj.pages) ? obj.pages : []
  if (!list.length) warnings.push('`pages` 배열이 비어 있습니다')
  const pages = list.map((p) => {
    if (typeof p === 'string') return splitTitle(p)
    const o = p as { title?: string; body?: string; text?: string; markdown?: string }
    return { title: (o.title ?? '').trim(), body: (o.body ?? o.text ?? o.markdown ?? '').trim() }
  })
  return { title: obj.title || obj.name || '룰북', pages, warnings }
}

/* ── 틀 만들기 ────────────────────────────────────────────── */

/** 만들어지는 레이어의 id — 밖에서도 이 이름으로 찾는다 (넘침 검사 등) */
export const BODY_LAYER = 'body'
export const TITLE_LAYER = 'title'
export const FOLIO_LAYER = 'folio'

export interface BuildOpts {
  size: PieceSize
  sheet: SheetSpec
  binding?: 'saddle' | 'staple'
  /** 본문 단 수 */
  columns?: number
  /** 룰북 이름 (없으면 원고 제목) */
  name?: string
}

/**
 * 원고 + 규격 → 쪽 틀 하나와 쪽 목록.
 *
 * 치수는 전부 **쪽 폭에 대한 비율**로 잡는다. A5 로 만들었다가 A6 로 바꿔도
 * 여백이 혼자 남지 않게 하려는 것이다. (`base` = 148mm 를 1로 본다)
 */
export function buildRulebook(doc: RulebookDoc, o: BuildOpts): { component: Component; rulebook: Rulebook } {
  const { w, h } = o.size
  const k = w / 148 // A5 세로를 기준으로 비율을 잡는다
  const m = Math.round(w * 0.095 * 10) / 10 // 좌우 여백
  const topBar = Math.round(h * 0.062 * 10) / 10 // 제목 자리의 높이
  const foot = Math.round(h * 0.05 * 10) / 10 // 쪽번호 자리
  const cid = uid('c')

  const title: TextLayer = {
    id: TITLE_LAYER,
    name: '쪽 제목',
    kind: 'text',
    x: m,
    y: Math.round(h * 0.055 * 10) / 10,
    w: w - 2 * m,
    h: topBar,
    size: Math.round(15 * k * 10) / 10,
    weight: 800,
    color: '#571026',
    align: 'left',
    valign: 'bottom',
    override: 'text',
  }

  const rule = {
    id: 'rule',
    name: '제목 밑줄',
    kind: 'rect' as const,
    x: m,
    y: Math.round((title.y + topBar + 1.5) * 10) / 10,
    w: w - 2 * m,
    h: 0.6,
    fill: '#C8A32E',
  }

  const bodyTop = Math.round((rule.y + 4) * 10) / 10
  const body: MarkdownLayer = {
    id: BODY_LAYER,
    name: '본문',
    kind: 'md',
    x: m,
    y: bodyTop,
    w: w - 2 * m,
    h: Math.round((h - bodyTop - foot) * 10) / 10,
    size: Math.round(8.6 * k * 10) / 10,
    color: '#2E232A',
    lineHeight: 1.5,
    align: 'left',
    columns: Math.max(1, o.columns ?? 1),
    gap: 5,
    override: 'text',
  }

  const folio: TextLayer = {
    id: FOLIO_LAYER,
    name: '쪽번호',
    kind: 'text',
    x: m,
    y: Math.round((h - foot + 1) * 10) / 10,
    w: w - 2 * m,
    h: 5,
    size: Math.round(7.5 * k * 10) / 10,
    color: '#7D1F38',
    align: 'center',
    override: 'text',
  }

  const component: Component = {
    id: cid,
    name: `${o.name ?? doc.title} 쪽`,
    size: { ...o.size },
    background: '#FFFDFA',
    layers: [rule, title, body, folio],
  }

  const pages: Instance[] = doc.pages.map((p, i) => ({
    id: uid('page'),
    qty: 1,
    values: {
      [TITLE_LAYER]: p.title,
      [BODY_LAYER]: p.body,
      // 표지에는 쪽번호를 안 넣는다 — 표지에 «1» 이 찍혀 있으면 그것부터 지우게 된다
      [FOLIO_LAYER]: i === 0 ? '' : String(i + 1),
    },
  }))

  const rulebook: Rulebook = {
    id: uid('book'),
    name: o.name ?? doc.title,
    component: cid,
    sheet: { ...o.sheet },
    binding: o.binding ?? 'saddle',
    duplex: 'short',
    pages,
  }

  return { component, rulebook }
}

/**
 * 이 쪽의 본문이 상자를 넘치는가 — **넘치면 종이에서 잘려 나간다.**
 *
 * 화면에서는 상자를 넘긴 글이 그냥 안 보일 뿐이라 «썼는데 없어졌다» 로 겪게 된다.
 * 그래서 쪽 목록에 미리 표시한다. 정밀한 조판이 아니라 **글자 수 어림**이므로
 * 경계에서는 틀릴 수 있다 — «여기부터 보라» 는 뜻이다 (`estimateLines` 주석 참조).
 */
export function bodyFit(
  component: Component,
  page: Instance
): { lines: number; capacity: number; over: boolean } | null {
  const l = component.layers.find((x) => x.id === BODY_LAYER && x.kind === 'md') as MarkdownLayer | undefined
  if (!l) return null
  const pt = 0.3527 // mm
  const em = (l.size ?? 9) * pt
  const cols = Math.max(1, Math.round(l.columns ?? 1))
  const colW = (l.w - (l.gap ?? 6) * (cols - 1)) / cols
  const charsPerLine = Math.max(6, colW / em)
  const capacity = (l.h / (em * (l.lineHeight ?? 1.5))) * cols
  const lines = estimateLines(parseMarkdown(page.values[BODY_LAYER] ?? ''), charsPerLine)
  // 어림이라 여유를 둔다 — 8% 안쪽은 넘쳤다고 말하지 않는다 (거짓 경고가 더 나쁘다)
  return { lines, capacity, over: lines > capacity * 1.08 }
}
