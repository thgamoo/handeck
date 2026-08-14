/**
 * 예제 프로젝트에 **룰북을 넣는다** — `example/rulebook.md` 원고에서.
 *
 *   npx esbuild example/make-rulebook.ts --bundle --platform=node --format=cjs \
 *     --outfile=example/make-rulebook.cjs --log-level=error && node example/make-rulebook.cjs
 *
 * 앱의 「원고 가져오기」와 **같은 코드**(`core/rulebook.ts`)를 쓴다. 결과가 갈리면
 * 예제가 «앱에서 만든 것» 이 아니게 되므로, 여기서 파서를 흉내 내지 않는다.
 *
 * 이미 룰북이 있으면 **그 자리를 갈아끼운다** — 원고를 고치고 다시 돌리면 된다.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { buildRulebook, parseRulebookSource } from '../src/core/rulebook.ts'
import type { Project } from '../src/core/model.ts'

const path = 'example/project.json'
const project = JSON.parse(readFileSync(path, 'utf8')) as Project
const doc = parseRulebookSource(readFileSync('example/rulebook.md', 'utf8'))

const built = buildRulebook(doc, {
  // A5 — A4 가로 한 장에 두 쪽. 집 프린터로 접어 만드는 가장 흔한 크기다
  size: { w: 148, h: 210, shape: 'rect' },
  sheet: { w: 297, h: 210, margin: 0, gap: 0, marks: 'none' },
  binding: 'saddle',
  name: '룰북',
})

// 옛 룰북이 쓰던 틀은 같이 치운다 (아무도 안 쓰는 틀이 남으면 파일만 커진다)
for (const old of project.rulebooks ?? []) delete project.components[old.component]
project.components[built.component.id] = built.component
project.rulebooks = [built.rulebook]

writeFileSync(path, `${JSON.stringify(project, null, 2)}\n`)
console.log(`룰북 ${built.rulebook.pages.length}쪽 — ${doc.pages.map((p) => p.title).join(' · ')}`)
for (const w of doc.warnings) console.log(`⚠ ${w}`)
