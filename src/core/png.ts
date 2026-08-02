/**
 * PNG 내보내기 — 공유하고 피드백 받으려고.
 *
 * **라이브러리를 쓰지 않는다.** 브라우저에 이미 있는 길로 간다:
 *
 *   렌더 결과(HTML) → SVG `<foreignObject>` → `<img>` → `<canvas>` → PNG
 *
 * 화면·인쇄와 **같은 렌더 코드**(`Piece`)를 쓰는 게 요점이다. 그리는 코드가
 * 두 벌이 되면 «화면은 이런데 내보낸 건 저렇다» 가 반드시 생긴다.
 *
 * 다만 SVG 안은 바깥과 이어져 있지 않아서 두 가지를 **직접 챙겨 넣어야** 한다:
 *   1. 그림 — `blob:` URL 은 SVG 안에서 못 읽는다. `data:` 로 바꿔 넣는다
 *   2. 글꼴 — `document.fonts` 등록분이 안 보인다. `@font-face` 로 심는다
 * 둘 다 빠뜨려도 **에러가 안 나고** 빈 칸·대체 글꼴로 조용히 나온다. 그래서 위험하다.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { Piece } from './render.tsx'
import type { Component, Instance, Keyword } from './model.ts'

/** CSS 가 정해둔 값 — 1인치 = 96px. SVG 안의 mm 도 이 기준이다. */
const MM = 96 / 25.4

export interface PngItem {
  component: Component
  instance?: Instance
}

export interface PngOpts {
  /** 한 줄에 몇 장. 여러 장일 때만 쓴다 */
  cols?: number
  /** 1 = 96dpi. 300dpi 로 뽑으려면 300/96 */
  scale?: number
  keywords?: Keyword[]
  /** 에셋 id -> data URL */
  assets: Map<string, string>
  /** 심을 `@font-face` 규칙 */
  fontCss?: string
  /** 여러 장일 때 사이·바깥 여백 (mm) */
  gap?: number
}

/**
 * 조각들을 한 장의 PNG 로.
 *
 * 한 장이면 카드 딱 그 크기로 나온다 (여백 없음 — 그대로 쓸 수 있는 그림).
 * 여러 장이면 격자로 깔고 흰 여백을 준다 (모아 보기 좋게).
 */
export async function exportPng(items: PngItem[], o: PngOpts): Promise<Blob> {
  const { svg, w, h } = buildSvg(items, o)
  return rasterize(svg, w, h)
}

/**
 * 그릴 SVG 문자열과 최종 픽셀 크기.
 *
 * 래스터화(브라우저가 하는 부분)와 떼어 놓는다 — 조립이 맞는지는 이쪽만 보면 되고,
 * 그래야 확인할 수 있다.
 */
export function buildSvg(items: PngItem[], o: PngOpts): { svg: string; w: number; h: number } {
  if (items.length === 0) throw new Error('내보낼 조각이 없습니다')
  const scale = o.scale ?? 1
  const first = items[0]!.component
  const pw = first.size.w
  const ph = first.size.h
  const many = items.length > 1
  const cols = many ? Math.max(1, o.cols ?? 4) : 1
  const rows = Math.ceil(items.length / cols)
  const gap = many ? (o.gap ?? 5) : 0
  const pad = many ? gap : 0

  const totalW = pad * 2 + cols * pw + (cols - 1) * gap
  const totalH = pad * 2 + rows * ph + (rows - 1) * gap

  // 조각마다 자리를 직접 잡는다. SVG 안에서는 레이아웃이 덜 예측 가능해서
  // 흐름에 맡기는 것보다 좌표를 박는 편이 안전하다.
  const cells = items
    .map((it, i) => {
      const cx = pad + (i % cols) * (pw + gap)
      const cy = pad + Math.floor(i / cols) * (ph + gap)
      const html = renderToStaticMarkup(
        Piece({
          component: it.component,
          instance: it.instance,
          opts: { assetUrl: (id) => o.assets.get(id), keywords: o.keywords },
        })
      )
      return `<div style="position:absolute;left:${cx}mm;top:${cy}mm">${html}</div>`
    })
    .join('')

  // 판이 쓰는 CSS 변수(글꼴 묶음)를 그대로 가져온다. 여기 없으면 `var(--hd-sans)` 가
  // 풀리지 않아 글꼴이 통째로 기본값이 된다.
  const root = getComputedStyle(document.documentElement)
  const vars = ['--hd-sans', '--hd-serif']
    .map((v) => `${v}:${root.getPropertyValue(v).trim()}`)
    .filter((s) => !s.endsWith(':'))
    .join(';')

  const wPx = totalW * MM
  const hPx = totalH * MM
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx * scale}" height="${hPx * scale}" ` +
    `viewBox="0 0 ${wPx} ${hPx}">` +
    `<foreignObject x="0" y="0" width="${wPx}" height="${hPx}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="${vars};position:relative;width:${totalW}mm;height:${totalH}mm;${many ? 'background:#fff;' : ''}">` +
    (o.fontCss ? `<style>${o.fontCss}</style>` : '') +
    cells +
    `</div></foreignObject></svg>`

  return { svg, w: wPx * scale, h: hPx * scale }
}

/** SVG 문자열 -> PNG. 여기서부터는 브라우저가 다 한다. */
async function rasterize(svg: string, w: number, h: number): Promise<Blob> {
  const img = new Image()
  // data: URL 로 넣는다. Blob URL 도 되지만 일부 브라우저가 SVG 안의 외부 참조를 막는다.
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await new Promise<void>((res, rej) => {
    img.onload = () => res()
    img.onerror = () => rej(new Error('그림으로 바꾸지 못했습니다'))
  })

  const cv = document.createElement('canvas')
  cv.width = Math.max(1, Math.round(w))
  cv.height = Math.max(1, Math.round(h))
  const ctx = cv.getContext('2d')
  if (!ctx) throw new Error('캔버스를 만들지 못했습니다')
  ctx.drawImage(img, 0, 0, cv.width, cv.height)

  return new Promise<Blob>((res, rej) => {
    cv.toBlob((b) => (b ? res(b) : rej(new Error('PNG 로 바꾸지 못했습니다'))), 'image/png')
  })
}

/** 받은 파일로 내려준다 */
export function downloadBlob(blob: Blob, name: string): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
