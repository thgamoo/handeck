/**
 * 아주 작은 마크다운 — **룰북 본문 한 덩어리**를 조판하기 위한 것.
 *
 * 왜 파서를 직접 두는가. 룰북은 카드와 달리 «글자 한 줄» 이 아니라 **문서**다.
 * 소제목·목록·표가 섞인 덩어리를 상자 하나에 흘려 넣어야 하는데,
 * 그걸 레이어로 쪼개면 문장을 한 줄 고칠 때마다 상자를 다시 잡아야 한다.
 *
 * 그렇다고 마크다운 라이브러리를 들이지는 않는다 — 의존성 셋(react·react-dom·zustand)이
 * 이 프로젝트의 성격이고, 룰북에 실제로 쓰는 문법은 아래가 전부다:
 *
 *   # ~ ####   소제목        - / * / 1.   목록 (두 단계까지)
 *   > 인용      | 표 |        ---   가로줄
 *   **굵게**  *기울임*  `코드`
 *
 * **조판은 브라우저에 맡긴다** (원칙 3). 여기서는 «무엇인지» 만 가르고,
 * 줄바꿈·자간·표 폭은 CSS 가 한다.
 */

export type MdAlign = 'left' | 'center' | 'right'

export type MdBlock =
  | { kind: 'h'; level: number; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'list'; ordered: boolean; items: { text: string; depth: number }[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'table'; head: string[]; align: MdAlign[]; rows: string[][] }
  | { kind: 'hr' }

/** 표 한 줄을 칸으로. 바깥쪽 `|` 는 있어도 없어도 된다. */
function cells(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}

const isTableSep = (line: string): boolean =>
  /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)

const alignOf = (spec: string): MdAlign => {
  const s = spec.trim()
  if (s.startsWith(':') && s.endsWith(':')) return 'center'
  if (s.endsWith(':')) return 'right'
  return 'left'
}

/**
 * 마크다운 → 블록 목록.
 *
 * **문단은 빈 줄로 끊는다.** 한 문단 안의 줄바꿈은 그대로 살린다 —
 * 규칙 문서는 «한 줄 = 한 조항» 으로 쓰는 일이 많아서, 여기서 이어붙이면
 * 원고와 인쇄물이 달라 보인다.
 */
export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: MdBlock[] = []
  let para: string[] = []

  const flush = () => {
    if (para.length) out.push({ kind: 'p', text: para.join('\n') })
    para = []
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!
    const line = raw.trimEnd()

    if (!line.trim()) {
      flush()
      continue
    }

    // 가로줄 — 룰북에서는 «쪽 나눔» 으로도 쓰이지만 그건 밖에서 미리 자른다
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush()
      out.push({ kind: 'hr' })
      continue
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      flush()
      out.push({ kind: 'h', level: h[1]!.length, text: h[2]!.trim() })
      continue
    }

    // 표 — 다음 줄이 구분선이어야 표다 (아니면 그냥 `|` 가 든 문장이다)
    if (line.includes('|') && lines[i + 1] && isTableSep(lines[i + 1]!)) {
      flush()
      const head = cells(line)
      const align = cells(lines[i + 1]!).map(alignOf)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) {
        rows.push(cells(lines[i]!))
        i++
      }
      i-- // 바깥 for 가 한 번 더 올린다
      out.push({ kind: 'table', head, align, rows })
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      flush()
      const acc: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i]!)) {
        acc.push(lines[i]!.replace(/^\s*>\s?/, ''))
        i++
      }
      i--
      out.push({ kind: 'quote', lines: acc })
      continue
    }

    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (li) {
      flush()
      const ordered = !/^[-*+]$/.test(li[2]!)
      const items: { text: string; depth: number }[] = []
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]!.trimEnd())
        if (!m) {
          // 목록 항목의 이어지는 줄 (들여쓴 채 글만 있는 줄)
          const cont = /^\s{2,}\S/.test(lines[i] ?? '') && items.length > 0
          if (!cont) break
          items[items.length - 1]!.text += `\n${lines[i]!.trim()}`
          i++
          continue
        }
        items.push({ text: m[3]!.trim(), depth: Math.min(2, Math.floor(m[1]!.length / 2)) })
        i++
      }
      i--
      out.push({ kind: 'list', ordered, items })
      continue
    }

    para.push(line.trim())
  }
  flush()
  return out
}

/** 글 안의 인라인 조각 */
export interface MdRun {
  text: string
  bold?: boolean
  italic?: boolean
  code?: boolean
}

/**
 * `**굵게**` · `*기울임*` · `` `코드` `` 만 가른다.
 *
 * 링크·이미지는 일부러 뺐다. 종이에 인쇄되는 물건이라 갈 곳이 없다.
 */
export function parseInline(text: string): MdRun[] {
  const out: MdRun[] = []
  const re = /(\*\*|__)(.+?)\1|(\*|_)(?!\s)(.+?)(?<!\s)\3|`([^`]+)`/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    if (m[2] !== undefined) out.push({ text: m[2], bold: true })
    else if (m[4] !== undefined) out.push({ text: m[4], italic: true })
    else if (m[5] !== undefined) out.push({ text: m[5], code: true })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out.filter((r) => r.text !== '')
}

/**
 * 이 글이 대충 몇 줄이 되는가 — **넘치는 쪽을 미리 짚어주려고** 쓴다.
 *
 * 브라우저 없이(=`npm run check` 에서도) 셀 수 있어야 해서 정밀한 조판이 아니라
 * **글자 수 어림**이다. 한글은 한 글자가 대략 폭 1칸, 라틴은 0.5칸으로 본다.
 * 넘침 경고는 «여기부터 보라» 는 뜻이지 «정확히 몇 줄» 이 아니다.
 */
export function estimateLines(blocks: MdBlock[], columnChars: number): number {
  const width = Math.max(8, columnChars)
  const runs = (s: string) => {
    let w = 0
    for (const ch of s) w += /[\x00-\xFF]/.test(ch) ? 0.5 : 1
    return w
  }
  const wrap = (s: string, w = width) => Math.max(1, Math.ceil(runs(s) / w))
  let n = 0
  for (const b of blocks) {
    switch (b.kind) {
      case 'h':
        n += wrap(b.text) + (b.level <= 2 ? 1.2 : 0.8)
        break
      case 'p':
        n += b.text.split('\n').reduce((s, l) => s + wrap(l), 0) + 0.5
        break
      case 'list':
        n += b.items.reduce((s, it) => s + wrap(it.text, width - 2), 0) + 0.5
        break
      case 'quote':
        n += b.lines.reduce((s, l) => s + wrap(l, width - 2), 0) + 0.8
        break
      case 'table':
        // 표는 칸이 좁아 줄이 접힌다. 행마다 최소 1줄 + 넉넉한 줄로 본다
        n +=
          1.4 +
          b.rows.reduce(
            (s, r) => s + Math.max(1, ...r.map((c) => wrap(c, Math.max(4, width / Math.max(1, b.head.length))))),
            0
          ) +
          0.6
        break
      case 'hr':
        n += 1
        break
    }
  }
  return n
}
