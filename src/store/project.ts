/**
 * 편집 상태.
 *
 * 실행취소는 «프로젝트 전체 스냅샷» 을 쌓는 방식이다.
 * 카드 프로젝트는 작아서(수백 KB) 이걸로 충분하고, 구현이 단순해 버그가 안 난다.
 * 이미지는 IndexedDB 에 따로 있어 스냅샷에 안 들어간다.
 */

import { create } from 'zustand'
import {
  type Board,
  type Component,
  type Deck,
  type DeckJson,
  type FontRef,
  type Instance,
  type Keyword,
  GROUP_COLORS,
  type Layer,
  type PieceSize,
  type Project,
  type Rulebook,
  type SheetSpec,
  A3,
  A4,
  uid,
} from '../core/model.ts'
import { buildRulebook, FOLIO_LAYER, type BuildOpts, type RulebookDoc } from '../core/rulebook.ts'
import { sampleProject } from '../core/sample.ts'

const LIMIT = 60

interface State {
  project: Project
  /**
   * 지금 무엇을 만들고 있는지 — **덱이냐 보드냐 룰북이냐.**
   *
   * 머리말의 탭이 이 값을 바꾸고, 왼쪽 목록·오른쪽 속성·인쇄가 전부 여기에 따라 갈린다.
   * 캔버스와 레이어 편집은 **갈리지 않는다** — 셋 다 결국 틀 하나를 그리는 일이라
   * 같은 화면을 그대로 쓴다. 차이는 «인스턴스가 무엇인가» 와 «종이에 앉히는 방식» 뿐이다.
   * (덱 = 카드 여러 장 / 보드 = 없음 / 룰북 = 쪽 여러 장)
   */
  mode: 'deck' | 'board' | 'book'
  deckId: string
  /** 지금 고른 보드 (`mode: 'board'` 일 때만 쓴다) */
  boardId: string
  /** 지금 고른 룰북 (`mode: 'book'` 일 때만 쓴다) */
  bookId: string
  /** 지금 고른 쪽. 룰북에서 인스턴스 자리를 대신한다 */
  pageId: string | null
  /**
   * 지금 앞면을 편집 중인지 뒷면인지.
   *
   * 덱마다 틀이 둘(앞·뒤)일 수 있는데 화면은 하나다. 어느 쪽을 그리고 고칠지를
   * 이 값 하나로 정한다. 뒷면이 없으면 항상 앞면이다.
   */
  side: 'front' | 'back'
  instanceId: string | null
  layerId: string | null
  dirty: boolean
  past: Project[]
  future: Project[]
  /** 제스처 시작 시점의 스냅샷 */
  pending: Project | null
  /** 연속 편집 합치기용 */
  lastKey: string | null
  lastAt: number

  deck: () => Deck
  /** 지금 고른 보드. 보드가 하나도 없으면 `undefined` */
  board: () => Board | undefined
  /** 지금 고른 룰북. 없으면 `undefined` */
  rulebook: () => Rulebook | undefined
  /** 지금 고른 쪽 (룰북) */
  page: () => Instance | undefined
  /** 지금 편집 중인 틀의 id (덱이면 앞/뒤, 보드면 그 보드의 틀) */
  componentId: () => string
  component: () => Component
  instance: () => Instance | undefined
  layer: () => Layer | undefined

  setMode: (mode: 'deck' | 'board' | 'book') => void
  selectDeck: (id: string) => void
  selectBoard: (id: string) => void
  selectRulebook: (id: string) => void
  selectPage: (id: string | null) => void
  selectSide: (side: 'front' | 'back') => void
  selectInstance: (id: string | null) => void
  selectLayer: (id: string | null) => void

  /**
   * 되돌릴 수 있는 변경.
   *
   * `coalesceKey` 를 주면 짧은 시간 안의 같은 키 변경은 **한 단계로 합친다.**
   * 입력칸에 «선혈의 비» 를 타이핑하면 키 입력마다 히스토리가 쌓이는데,
   * 되돌리기를 6번 눌러야 지워지는 건 아무도 원하지 않는다.
   */
  edit: (fn: (p: Project) => void, coalesceKey?: string) => void

  /**
   * 드래그처럼 «시작과 끝이 있는» 조작용.
   *   begin() -> live() 여러 번 -> commit()
   * 히스토리에는 **놓았을 때 한 번만** 남는다. 중간 경로는 남지 않는다.
   */
  beginGesture: () => void
  liveEdit: (fn: (p: Project) => void) => void
  commitGesture: () => void

  undo: () => void
  redo: () => void

  /** coalesceKey 가 있으면 연속 편집이 한 단계로 합쳐진다 */
  patchLayer: (id: string, patch: Partial<Layer>, coalesceKey?: string) => void
  /** 제스처 중 호출 — 히스토리에 안 쌓인다 */
  patchLayerLive: (id: string, patch: Partial<Layer>) => void
  addLayer: (kind: Layer['kind']) => void
  /** 원본 바로 앞에 사본을 놓고 그걸 고른다 */
  duplicateLayer: (id: string) => void
  removeLayer: (id: string) => void
  moveLayer: (id: string, dir: -1 | 1) => void
  /** 목록에서 끌어 옮겼을 때. 배열 순서(뒤 -> 앞) 기준 id 목록을 그대로 받는다. */
  setLayerOrder: (idsBackToFront: string[]) => void

  /** 뒷면 틀을 붙이거나 뗀다. `'new'` 면 앞면과 같은 규격의 빈 틀을 만든다. */
  setBack: (idOrNew: string | 'new' | undefined) => void
  setDuplex: (v: false | 'long' | 'short') => void
  /**
   * 뒷면 격자를 좌우로 뒤집을지. 기본은 뒤집기.
   *
   * 묶어 인쇄하면 조판이 **묶음의 첫 덱** 설정을 따르므로, 고른 덱이 아니라
   * 그 덱을 지정할 수 있어야 한다 (`deckId` 를 주면 그쪽을 고친다).
   */
  setMirrorBack: (v: boolean, deckId?: string) => void

  addDeck: (name: string, size: PieceSize) => void
  renameDeck: (id: string, name: string) => void
  /** 끌어서 옮겼을 때. 화면에 보이는 순서 그대로의 id 목록을 받는다. */
  setDeckOrder: (ids: string[]) => void
  setDeckNote: (id: string, note: string) => void
  /** 기대 장수. `undefined` 면 대조를 끈다 */
  setDeckExpect: (id: string, n: number | undefined) => void
  renameProject: (name: string) => void

  /** 이 프로젝트가 쓰는 글꼴 목록에 넣고 뺀다 (파일은 IndexedDB 에 따로 있다) */
  addFont: (ref: FontRef) => void
  removeFont: (id: string) => void
  /** 글꼴 이름이 바뀌면 그 글꼴을 쓰던 글자 레이어도 같이 따라가야 한다 */
  renameFontRef: (id: string, family: string) => void

  /**
   * JSON 꾸러미로 이 덱의 내용을 갈아끼운다 (다른 프로젝트에서 구조 가져오기).
   *
   * **덱과 틀의 id 는 그대로 두고 «내용» 만 바꾼다.** 그래야 이 덱을 가리키던
   * 인쇄 묶음·선택 상태가 안 깨진다.
   */
  applyDeckJson: (deckId: string, data: DeckJson, withCards: boolean) => void

  /** 인쇄 묶기 — 여러 덱을 한 종이에 이어 깐다 */
  addPrintGroup: (name: string) => void
  renamePrintGroup: (id: string, name: string) => void
  setPrintGroupColor: (id: string, color: string) => void
  removePrintGroup: (id: string) => void
  /** 덱을 묶음에 넣거나(`groupId`) 뺀다(`null`). 한 덱은 한 묶음에만 든다. */
  setDeckGroup: (deckId: string, groupId: string | null) => void

  /** 카드 글에서 다르게 그릴 낱말 — 프로젝트 전체가 공유한다 */
  addKeyword: () => void
  patchKeyword: (id: string, patch: Partial<Keyword>) => void
  removeKeyword: (id: string) => void
  duplicateDeck: (id: string) => void
  removeDeck: (id: string) => void

  /** 보드 — 한 장짜리 큰 인쇄물 (판·참조표) */
  addBoard: (name: string, size: PieceSize) => void
  renameBoard: (id: string, name: string) => void
  setBoardOrder: (ids: string[]) => void
  setBoardNote: (id: string, note: string) => void
  duplicateBoard: (id: string) => void
  removeBoard: (id: string) => void
  /** 지금 고른 보드의 종이·타일링 설정 */
  patchBoard: (patch: Partial<Pick<Board, 'tiling' | 'overlap'>>) => void
  patchBoardSheet: (patch: Partial<SheetSpec>) => void

  /** 룰북 — 여러 쪽짜리 인쇄물 */
  addRulebook: (name: string, size: PieceSize, sheet: SheetSpec) => void
  /**
   * 원고(마크다운·JSON)에서 룰북을 통째로 만든다.
   *
   * **가져오기가 곧 첫 편집이다.** 20쪽짜리 문서를 상자부터 놓아 만들게 하면
   * 이 도구가 없애려던 루프가 그대로 돌아온다.
   */
  importRulebook: (doc: RulebookDoc, opts: BuildOpts) => void
  renameRulebook: (id: string, name: string) => void
  setRulebookOrder: (ids: string[]) => void
  setRulebookNote: (id: string, note: string) => void
  duplicateRulebook: (id: string) => void
  removeRulebook: (id: string) => void
  /** 지금 고른 룰북의 제본·양면 설정 */
  patchRulebook: (patch: Partial<Pick<Rulebook, 'binding' | 'duplex'>>) => void
  patchRulebookSheet: (patch: Partial<SheetSpec>) => void

  /** 쪽 — 룰북 안에서 인스턴스 자리 */
  addPage: () => void
  duplicatePage: (id: string) => void
  removePage: (id: string) => void
  /** 끌어서 순서를 바꿨을 때. 화면에 보이는 순서 그대로의 id 목록 */
  setPageOrder: (ids: string[]) => void
  /** 한 칸 앞뒤로. 쪽은 순서가 곧 내용이라 목록에서 자주 옮긴다 */
  movePage: (id: string, dir: -1 | 1) => void
  /** 쪽번호 값을 지금 순서대로 다시 매긴다 (표지는 비운다) */
  renumberPages: () => void
  /** 조각 크기·모양 */
  patchSize: (patch: Partial<PieceSize>) => void
  patchSheet: (patch: Partial<SheetSpec>) => void

  addInstance: () => void
  duplicateInstance: (id: string) => void
  removeInstance: (id: string) => void
  setValue: (instanceId: string, layerId: string, value: string) => void

  load: (p: Project) => void
  markSaved: () => void
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export const useStore = create<State>((set, get) => ({
  project: sampleProject(),
  mode: 'deck',
  deckId: 'omens',
  boardId: '',
  bookId: '',
  pageId: null,
  side: 'front',
  instanceId: 'i1',
  layerId: null,
  dirty: false,
  past: [],
  future: [],
  pending: null,
  lastKey: null,
  lastAt: 0,

  deck: () => {
    const s = get()
    return s.project.decks.find((d) => d.id === s.deckId) ?? s.project.decks[0]!
  },
  board: () => {
    const s = get()
    const bs = s.project.boards ?? []
    return bs.find((b) => b.id === s.boardId) ?? bs[0]
  },
  rulebook: () => {
    const s = get()
    const bs = s.project.rulebooks ?? []
    return bs.find((b) => b.id === s.bookId) ?? bs[0]
  },
  page: () => {
    const s = get()
    const b = s.rulebook()
    if (!b) return undefined
    return b.pages.find((p) => p.id === s.pageId) ?? b.pages[0]
  },
  componentId: () => {
    const s = get()
    // 보드·룰북에는 앞뒤가 없다 — 틀이 하나뿐이다.
    // 탭은 눌렀는데 만든 것이 없으면 덱 쪽으로 떨어뜨린다 (빈 화면 방지)
    if (s.mode === 'board') {
      const b = s.board()
      if (b) return b.component
    }
    if (s.mode === 'book') {
      const b = s.rulebook()
      if (b) return b.component
    }
    const d = s.deck()
    // 뒷면을 보고 있는데 뒷면이 없어졌으면 앞면으로 되돌린다 (빈 화면 방지)
    return s.side === 'back' && d.back ? d.back : d.component
  },
  component: () => {
    const s = get()
    return s.project.components[s.componentId()]!
  },
  instance: () => {
    const s = get()
    // 보드는 «같은 틀로 여러 장» 이 아니라서 인스턴스가 없다
    if (s.mode === 'board') return undefined
    // 룰북에서는 **쪽이 곧 인스턴스**다. 캔버스·PNG·속성 패널이 이걸 그대로 쓴다 —
    // 그래서 «쪽마다 다른 본문» 이 카드의 «카드마다 다르게» 와 같은 길로 흐른다.
    if (s.mode === 'book') return s.page()
    return s.deck().instances.find((i) => i.id === s.instanceId)
  },
  layer: () => {
    const s = get()
    return s.component().layers.find((l) => l.id === s.layerId)
  },

  setMode: (mode) =>
    set((s) => {
      if (mode === 'board') {
        const bs = s.project.boards ?? []
        // 보드가 하나도 없으면 탭만 바꾸고 목록에서 만들게 둔다 (자동 생성 안 함 —
        // 탭을 눌러본 것만으로 프로젝트가 바뀌면 되돌리기가 놀란다)
        const b = bs.find((x) => x.id === s.boardId) ?? bs[0]
        return { mode, boardId: b?.id ?? '', instanceId: null, layerId: null }
      }
      if (mode === 'book') {
        const bs = s.project.rulebooks ?? []
        const b = bs.find((x) => x.id === s.bookId) ?? bs[0]
        return { mode, bookId: b?.id ?? '', pageId: b?.pages[0]?.id ?? null, instanceId: null, layerId: null }
      }
      return { mode, side: 'front', layerId: null }
    }),

  selectDeck: (id) => set({ deckId: id, mode: 'deck', side: 'front', instanceId: null, layerId: null }),
  selectBoard: (id) => set({ boardId: id, mode: 'board', instanceId: null, layerId: null }),
  selectRulebook: (id) =>
    set((s) => {
      const b = (s.project.rulebooks ?? []).find((x) => x.id === id)
      return { bookId: id, mode: 'book' as const, pageId: b?.pages[0]?.id ?? null, instanceId: null, layerId: null }
    }),
  selectPage: (id) => set({ pageId: id }),
  selectSide: (side) => set({ side, layerId: null }),
  selectInstance: (id) => set({ instanceId: id }),
  selectLayer: (id) => set({ layerId: id }),

  edit: (fn, coalesceKey) =>
    set((s) => {
      const next = clone(s.project)
      fn(next)
      const now = Date.now()
      // 같은 대상을 연달아 고치는 중이면 히스토리를 새로 쌓지 않고 덮어쓴다
      const merge = !!coalesceKey && coalesceKey === s.lastKey && now - s.lastAt < 900
      return {
        project: next,
        past: merge ? s.past : [...s.past, s.project].slice(-LIMIT),
        future: [],
        dirty: true,
        lastKey: coalesceKey ?? null,
        lastAt: now,
      }
    }),

  beginGesture: () => set((s) => ({ pending: s.project, lastKey: null })),

  liveEdit: (fn) =>
    set((s) => {
      const next = clone(s.project)
      fn(next)
      return { project: next, dirty: true }
    }),

  commitGesture: () =>
    set((s) => {
      if (!s.pending || s.pending === s.project) return { pending: null }
      return {
        pending: null,
        past: [...s.past, s.pending].slice(-LIMIT),
        future: [],
        lastKey: null,
      }
    }),

  undo: () =>
    set((s) => {
      const prev = s.past.at(-1)
      if (!prev) return s
      return {
        project: prev,
        past: s.past.slice(0, -1),
        future: [s.project, ...s.future].slice(0, LIMIT),
        dirty: true,
        lastKey: null,
      }
    }),

  redo: () =>
    set((s) => {
      const next = s.future[0]
      if (!next) return s
      return {
        project: next,
        past: [...s.past, s.project].slice(-LIMIT),
        future: s.future.slice(1),
        dirty: true,
        lastKey: null,
      }
    }),

  patchLayer: (id, patch, coalesceKey) =>
    get().edit((p) => {
      const c = p.components[get().componentId()]!
      const i = c.layers.findIndex((l) => l.id === id)
      if (i >= 0) c.layers[i] = { ...c.layers[i]!, ...patch } as Layer
    }, coalesceKey),

  patchLayerLive: (id, patch) =>
    get().liveEdit((p) => {
      const c = p.components[get().componentId()]!
      const i = c.layers.findIndex((l) => l.id === id)
      if (i >= 0) c.layers[i] = { ...c.layers[i]!, ...patch } as Layer
    }),

  addLayer: (kind) => {
    const id = uid(kind)
    const c = get().component()
    const cx = c.size.w / 2
    const common = { id, x: cx - 20, y: 20, w: 40, h: 12, hidden: false }
    const layer: Layer =
      kind === 'text'
        ? { ...common, kind: 'text', name: '새 글자', text: '글자', size: 12, weight: 700, color: '#2E232A', align: 'center' }
        : kind === 'md'
          ? {
              ...common,
              kind: 'md',
              name: '새 본문',
              // 글이 흐르는 상자라 처음부터 넓어야 쓸모가 있다.
              // 좁게 만들어 놓으면 «글이 안 보인다» 부터 겪는다.
              x: Math.max(4, c.size.w * 0.1),
              y: Math.max(4, c.size.h * 0.15),
              w: c.size.w * 0.8,
              h: c.size.h * 0.6,
              text: '## 소제목\n\n본문을 **마크다운**으로 씁니다.\n\n- 목록\n- 표 · 인용도 됩니다',
              size: 9,
              color: '#2E232A',
              lineHeight: 1.5,
              align: 'left',
            }
        : kind === 'image'
          ? { ...common, kind: 'image', name: '새 이미지', w: 30, h: 30, fit: 'cover' }
          : kind === 'rect'
            ? { ...common, kind: 'rect', name: '새 도형', fill: 'rgba(125,31,56,.25)' }
            : {
                ...common,
                kind: 'gradient',
                name: '새 그늘',
                w: c.size.w,
                x: 0,
                h: 30,
                direction: 'to bottom',
                stops: ['rgba(0,0,0,0)', 'rgba(0,0,0,.75)'],
              }
    get().edit((p) => {
      p.components[get().componentId()]!.layers.push(layer)
    })
    set({ layerId: id })
  },

  duplicateLayer: (id) => {
    const copyId = uid(get().component().layers.find((l) => l.id === id)?.kind ?? 'layer')
    get().edit((p) => {
      const cid = get().componentId()
      const c = p.components[cid]!
      const i = c.layers.findIndex((l) => l.id === id)
      if (i < 0) return
      const src = c.layers[i]!
      // 살짝 밀어 놓는다 — 정확히 겹쳐 있으면 복제됐는지 알 수 없다
      const copy = { ...clone(src), id: copyId, name: `${src.name} 사본`, x: src.x + 2, y: src.y + 2 }
      c.layers.splice(i + 1, 0, copy) // 원본 «앞»(배열 뒤)에 놓는다

      // «카드마다 다르게» 레이어면 카드별 값도 같이 복사한다.
      // 값은 레이어 id 로 묶여 있어서, 안 옮기면 사본이 전부 빈 채로 나온다 —
      // 복제해서 조금 고치려던 사람에게는 그게 «복제가 안 된» 것으로 보인다.
      if (!src.override) return
      for (const d of p.decks) {
        if (d.component !== cid && d.back !== cid) continue
        for (const inst of d.instances) {
          const v = inst.values[id]
          if (v !== undefined) inst.values[copyId] = v
        }
      }
      // 룰북의 쪽도 같은 규칙이다 — 쪽이 곧 인스턴스다
      for (const b of p.rulebooks ?? []) {
        if (b.component !== cid) continue
        for (const pg of b.pages) {
          const v = pg.values[id]
          if (v !== undefined) pg.values[copyId] = v
        }
      }
    })
    set({ layerId: copyId })
  },

  removeLayer: (id) => {
    get().edit((p) => {
      const c = p.components[get().componentId()]!
      c.layers = c.layers.filter((l) => l.id !== id)
      // 이 레이어를 덮어쓰던 인스턴스 값도 같이 지운다
      for (const d of p.decks) for (const i of d.instances) delete i.values[id]
      for (const b of p.rulebooks ?? []) for (const pg of b.pages) delete pg.values[id]
    })
    set({ layerId: null })
  },

  moveLayer: (id, dir) =>
    get().edit((p) => {
      const ls = p.components[get().componentId()]!.layers
      const i = ls.findIndex((l) => l.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= ls.length) return
      ;[ls[i], ls[j]] = [ls[j]!, ls[i]!]
    }),

  setLayerOrder: (ids) =>
    get().edit((p) => {
      const c = p.components[get().componentId()]!
      const byId = new Map(c.layers.map((l) => [l.id, l]))
      const next = ids.map((id) => byId.get(id)).filter((l): l is Layer => !!l)
      // 빠진 게 있으면 순서를 건드리지 않는다 (데이터를 잃는 것보다 낫다)
      if (next.length !== c.layers.length) return
      c.layers = next
    }),

  setBack: (idOrNew) => {
    const d0 = get().deck()
    const front = get().project.components[d0.component]!
    if (idOrNew === undefined) {
      get().edit((p) => {
        const d = p.decks.find((x) => x.id === d0.id)!
        const old = d.back
        d.back = undefined
        d.duplex = false
        // 아무도 안 쓰게 된 뒷면 틀은 같이 치운다
        if (old && !p.decks.some((x) => x.back === old || x.component === old)) delete p.components[old]
      })
      set({ side: 'front', layerId: null })
      return
    }
    if (idOrNew === 'new') {
      const cid = uid('c')
      get().edit((p) => {
        p.components[cid] = {
          id: cid,
          name: `${front.name} 뒷면`,
          // 규격은 앞면과 반드시 같아야 한다. 다르면 앞뒤가 안 맞물린다.
          size: { ...front.size },
          background: front.background,
          layers: [],
        }
        const d = p.decks.find((x) => x.id === d0.id)!
        d.back = cid
        if (!d.duplex) d.duplex = 'long'
      })
      set({ side: 'back', layerId: null })
      return
    }
    get().edit((p) => {
      const d = p.decks.find((x) => x.id === d0.id)!
      d.back = idOrNew
      if (!d.duplex) d.duplex = 'long'
    })
    set({ side: 'back', layerId: null })
  },

  setDuplex: (v) =>
    get().edit((p) => {
      p.decks.find((x) => x.id === get().deckId)!.duplex = v
    }),

  setMirrorBack: (v, deckId) =>
    get().edit((p) => {
      const d = p.decks.find((x) => x.id === (deckId ?? get().deckId))
      if (!d) return
      // 기본값(뒤집기)이면 아예 안 적는다 — 저장 파일에 «기본과 같은 값» 이 쌓이면
      // 나중에 기본을 바꿀 때 옛 파일만 안 따라온다
      if (v) delete d.mirrorBack
      else d.mirrorBack = false
    }),

  addDeck: (name, size) => {
    const cid = uid('c')
    const did = uid('deck')
    get().edit((p) => {
      p.components[cid] = {
        id: cid,
        name,
        size,
        background: '#FFFDFA',
        // 빈 판에서 시작하면 뭘 해야 할지 모른다. 채울 그림 한 장을 깔아둔다.
        layers: [
          {
            id: uid('image'),
            name: '그림',
            kind: 'image',
            x: 0,
            y: 0,
            w: size.w,
            h: size.h,
            fit: 'cover',
            override: 'image',
          },
        ],
      }
      p.decks.push({
        id: did,
        name,
        component: cid,
        sheet: { ...A4 },
        duplex: false,
        instances: [{ id: uid('card'), qty: 1, values: {} }],
      })
    })
    const d = get().project.decks.find((x) => x.id === did)!
    set({ deckId: did, instanceId: d.instances[0]!.id, layerId: null })
  },

  renameDeck: (id, name) =>
    get().edit((p) => {
      const d = p.decks.find((x) => x.id === id)
      if (!d) return
      d.name = name
      // 컴포넌트를 이 덱만 쓰고 있으면 이름을 같이 맞춰준다
      if (p.decks.filter((x) => x.component === d.component).length === 1) {
        const c = p.components[d.component]
        if (c) c.name = name
      }
    }, `dn:${id}`),

  setDeckOrder: (ids) =>
    get().edit((p) => {
      const byId = new Map(p.decks.map((d) => [d.id, d]))
      const next = ids.map((id) => byId.get(id)).filter((d): d is Deck => !!d)
      // 빠진 게 있으면 순서를 건드리지 않는다 (덱을 잃는 것보다 낫다)
      if (next.length !== p.decks.length) return
      p.decks = next
    }),

  setDeckNote: (id, note) =>
    get().edit((p) => {
      const d = p.decks.find((x) => x.id === id)
      if (!d) return
      if (note.trim()) d.note = note
      else delete d.note
    }, `dnote:${id}`),

  setDeckExpect: (id, n) =>
    get().edit((p) => {
      const d = p.decks.find((x) => x.id === id)
      if (!d) return
      if (n === undefined || !Number.isFinite(n) || n < 0) delete d.expect
      else d.expect = Math.round(n)
    }, `dexp:${id}`),

  renameProject: (name) =>
    get().edit((p) => {
      p.name = name
    }, 'pname'),

  applyDeckJson: (deckId, data, withCards) =>
    get().edit((p) => {
      const d = p.decks.find((x) => x.id === deckId)
      if (!d) return

      // 앞면 — 지금 틀의 껍데기(id·이름)는 두고 알맹이만 바꾼다
      const front = p.components[d.component]
      if (!front) return
      front.size = { ...data.front.size }
      front.background = data.front.background
      front.layers = clone(data.front.layers)

      // 뒷면 — 꾸러미에 있으면 만들거나 갈아끼우고, 없으면 뗀다
      if (data.back) {
        if (!d.back || !p.components[d.back]) {
          const bid = uid('c')
          p.components[bid] = { id: bid, name: `${d.name} 뒷면`, size: { ...data.back.size }, background: data.back.background, layers: clone(data.back.layers) }
          d.back = bid
        } else {
          const back = p.components[d.back]!
          back.size = { ...data.back.size }
          back.background = data.back.background
          back.layers = clone(data.back.layers)
        }
      } else if (d.back) {
        const old = d.back
        d.back = undefined
        if (!p.decks.some((x) => x.back === old || x.component === old)) delete p.components[old]
      }

      d.name = data.deck.name || d.name
      d.sheet = { ...data.deck.sheet }
      d.duplex = d.back ? data.deck.duplex : false
      if (data.deck.expect !== undefined) d.expect = data.deck.expect
      if (data.deck.note) d.note = data.deck.note

      // 카드 내용은 고를 수 있다. 안 가져오면 **기존 카드의 값이 새 레이어와 안 맞을 수 있다**
      // (오버라이드 값은 레이어 id 로 묶여 있다) — 부르는 쪽에서 경고한다.
      if (withCards && data.instances?.length) {
        d.instances = data.instances.map((i) => ({ id: uid('card'), qty: i.qty, values: { ...i.values } }))
      }
    }),

  addPrintGroup: (name) =>
    get().edit((p) => {
      const list = p.printGroups ?? []
      // 만든 순서대로 팔레트를 돌려 쓴다 — 묶음이 둘 이상이면 색으로 구분해야 한다
      const color = GROUP_COLORS[list.length % GROUP_COLORS.length]!
      p.printGroups = [...list, { id: uid('pg'), name, decks: [], color }]
    }),

  setPrintGroupColor: (id, color) =>
    get().edit((p) => {
      const g = (p.printGroups ?? []).find((x) => x.id === id)
      if (g) g.color = color
    }),

  renamePrintGroup: (id, name) =>
    get().edit((p) => {
      const g = (p.printGroups ?? []).find((x) => x.id === id)
      if (g) g.name = name
    }, `pg:${id}`),

  removePrintGroup: (id) =>
    get().edit((p) => {
      p.printGroups = (p.printGroups ?? []).filter((g) => g.id !== id)
    }),

  setDeckGroup: (deckId, groupId) =>
    get().edit((p) => {
      // 한 덱이 두 묶음에 들면 어느 쪽으로 인쇄할지 알 수 없다 — 먼저 전부에서 뺀다
      for (const g of p.printGroups ?? []) g.decks = g.decks.filter((d) => d !== deckId)
      if (!groupId) return
      const g = (p.printGroups ?? []).find((x) => x.id === groupId)
      if (g && !g.decks.includes(deckId)) g.decks.push(deckId)
    }),

  addKeyword: () =>
    get().edit((p) => {
      p.keywords = [...(p.keywords ?? []), { id: uid('kw'), word: '', style: 'chip' }]
    }),

  patchKeyword: (id, patch) =>
    get().edit(
      (p) => {
        const k = (p.keywords ?? []).find((x) => x.id === id)
        if (k) Object.assign(k, patch)
      },
      // 낱말을 타이핑하는 동안 되돌리기가 글자 수만큼 쌓이면 못 쓴다
      `kw:${id}`
    ),

  removeKeyword: (id) =>
    get().edit((p) => {
      p.keywords = (p.keywords ?? []).filter((k) => k.id !== id)
    }),

  addFont: (ref) =>
    get().edit((p) => {
      p.fonts = [...(p.fonts ?? []).filter((f) => f.id !== ref.id), ref]
    }),

  removeFont: (id) =>
    get().edit((p) => {
      const gone = (p.fonts ?? []).find((f) => f.id === id)
      p.fonts = (p.fonts ?? []).filter((f) => f.id !== id)
      // 그 글꼴을 쓰던 글자는 기본 글꼴로 돌린다. 없는 이름을 가리킨 채 두면
      // 화면에는 대체 글꼴로 나오는데 왜 그런지 알 수가 없다.
      if (!gone) return
      for (const c of Object.values(p.components))
        for (const l of c.layers) if (l.kind === 'text' && l.font === gone.family) delete l.font
    }),

  renameFontRef: (id, family) =>
    get().edit((p) => {
      const ref = (p.fonts ?? []).find((f) => f.id === id)
      if (!ref || ref.family === family) return
      const before = ref.family
      ref.family = family
      for (const c of Object.values(p.components))
        for (const l of c.layers) if (l.kind === 'text' && l.font === before) l.font = family
    }),

  duplicateDeck: (id) => {
    const cid = uid('c')
    const did = uid('deck')
    get().edit((p) => {
      const src = p.decks.find((x) => x.id === id)
      const sc = src && p.components[src.component]
      if (!src || !sc) return
      // 틀까지 복사한다. 원본을 고쳐도 사본이 안 따라가는 게 기대에 맞다.
      p.components[cid] = structuredClone({ ...sc, id: cid, name: `${sc.name} 사본` })
      // 뒷면도 같이 복사한다. 공유해두면 사본의 뒷면을 고칠 때 원본이 같이 바뀐다.
      let bid: string | undefined
      const sb = src.back ? p.components[src.back] : undefined
      if (sb) {
        bid = uid('c')
        p.components[bid] = structuredClone({ ...sb, id: bid, name: `${sb.name} 사본` })
      }
      p.decks.push(
        structuredClone({
          ...src,
          id: did,
          name: `${src.name} 사본`,
          component: cid,
          back: bid,
          instances: src.instances.map((i) => ({ ...i, id: uid('card'), values: { ...i.values } })),
        })
      )
    })
    if (get().project.decks.some((d) => d.id === did)) set({ deckId: did, side: 'front', instanceId: null, layerId: null })
  },

  removeDeck: (id) => {
    const p0 = get().project
    if (p0.decks.length <= 1) return // 마지막 덱은 남긴다 — 빈 화면이 되면 복구가 어렵다
    get().edit((p) => {
      const d = p.decks.find((x) => x.id === id)
      p.decks = p.decks.filter((x) => x.id !== id)
      // 아무도 안 쓰는 틀은 같이 지운다 (앞면·뒷면 둘 다).
      // 보드도 같이 본다 — 보드가 쓰고 있는 틀을 덱을 지웠다고 없애면 안 된다.
      const used = (cid: string) =>
        p.decks.some((x) => x.component === cid || x.back === cid) ||
        (p.boards ?? []).some((b) => b.component === cid)
      if (d && !used(d.component)) delete p.components[d.component]
      if (d?.back && !used(d.back)) delete p.components[d.back]
    })
    if (get().deckId === id) {
      const next = get().project.decks[0]!
      set({ deckId: next.id, side: 'front', instanceId: next.instances[0]?.id ?? null, layerId: null })
    }
  },

  // ── 보드 ────────────────────────────────────────────────────────────────
  // 덱과 같은 모양으로 맞춰 뒀다. 다른 건 «인스턴스가 없다» 는 것뿐이다.

  addBoard: (name, size) => {
    const cid = uid('c')
    const bid = uid('board')
    get().edit((p) => {
      p.components[cid] = {
        id: cid,
        name,
        size,
        background: '#FFFDFA',
        // 덱과 달리 «카드마다 다르게» 가 없다. 바탕 그림 한 장을 공통으로 깔아둔다.
        layers: [
          { id: uid('image'), name: '바탕 그림', kind: 'image', x: 0, y: 0, w: size.w, h: size.h, fit: 'cover' },
        ],
      }
      if (!p.boards) p.boards = []
      p.boards.push({
        id: bid,
        name,
        component: cid,
        // A4 한 장에 들어가는 판이면 A4, 아니면 A3 부터 보여준다.
        // 어차피 속성에서 바꾸지만 «열자마자 잘려 보이는» 첫인상을 피한다.
        sheet: size.w <= 190 && size.h <= 277 ? { ...A4 } : { ...A3 },
        tiling: 'single',
        overlap: 10,
      })
    })
    set({ mode: 'board', boardId: bid, instanceId: null, layerId: null })
  },

  renameBoard: (id, name) =>
    get().edit((p) => {
      const b = p.boards?.find((x) => x.id === id)
      if (!b) return
      b.name = name
      // 틀을 이 보드만 쓰고 있으면 이름을 같이 맞춘다 (덱과 같은 규칙)
      const c = p.components[b.component]
      if (c && (p.boards ?? []).filter((x) => x.component === b.component).length === 1) c.name = name
    }, `bn:${id}`),

  setBoardOrder: (ids) =>
    get().edit((p) => {
      const bs = p.boards ?? []
      const byId = new Map(bs.map((b) => [b.id, b]))
      const next = ids.map((id) => byId.get(id)).filter((b): b is Board => !!b)
      if (next.length !== bs.length) return // 빠진 게 있으면 순서를 안 건드린다
      p.boards = next
    }),

  setBoardNote: (id, note) =>
    get().edit((p) => {
      const b = p.boards?.find((x) => x.id === id)
      if (!b) return
      if (note.trim()) b.note = note
      else delete b.note
    }, `bnote:${id}`),

  duplicateBoard: (id) => {
    const cid = uid('c')
    const bid = uid('board')
    get().edit((p) => {
      const src = p.boards?.find((x) => x.id === id)
      const sc = src && p.components[src.component]
      if (!src || !sc) return
      // 틀까지 복사한다 — 원본을 고쳐도 사본이 안 따라가는 게 기대에 맞다 (덱과 같다)
      p.components[cid] = structuredClone({ ...sc, id: cid, name: `${sc.name} 사본` })
      p.boards!.push(structuredClone({ ...src, id: bid, name: `${src.name} 사본`, component: cid }))
    })
    if ((get().project.boards ?? []).some((b) => b.id === bid))
      set({ mode: 'board', boardId: bid, layerId: null })
  },

  removeBoard: (id) => {
    get().edit((p) => {
      const b = p.boards?.find((x) => x.id === id)
      p.boards = (p.boards ?? []).filter((x) => x.id !== id)
      // 아무도 안 쓰는 틀은 같이 지운다. 덱이 쓰고 있으면 남긴다.
      const used = (cid: string) =>
        p.decks.some((d) => d.component === cid || d.back === cid) ||
        (p.boards ?? []).some((x) => x.component === cid)
      if (b && !used(b.component)) delete p.components[b.component]
    })
    // 덱과 달리 **마지막 하나도 지울 수 있다.** 보드는 없어도 되는 구성품이고,
    // 빈 목록에서 «+ 보드» 로 다시 만들면 그만이다.
    if (get().boardId === id) set({ boardId: get().project.boards?.[0]?.id ?? '', layerId: null })
  },

  patchBoard: (patch) =>
    get().edit((p) => {
      const b = p.boards?.find((x) => x.id === get().boardId)
      if (b) Object.assign(b, patch)
    }, `b:${get().boardId}`),

  patchBoardSheet: (patch) =>
    get().edit((p) => {
      const b = p.boards?.find((x) => x.id === get().boardId)
      if (b) b.sheet = { ...b.sheet, ...patch }
    }, `bsh:${get().boardId}`),

  // ── 룰북 ────────────────────────────────────────────────────────────────
  // 덱과 같은 모양이다. 다른 건 «인스턴스가 쪽이고, 수량이 늘 1» 이라는 것뿐.

  addRulebook: (name, size, sheet) => {
    const doc: RulebookDoc = {
      title: name,
      // 빈 룰북에서 시작하면 무엇을 해야 할지 모른다. 표지 + 첫 쪽을 깔아둔다.
      pages: [
        { title: name, body: '> 한 줄 소개\n\n2~4인 · 만 14세 이상 · 약 60분' },
        { title: '준비물', body: '| 구성품 | 개수 |\n| --- | ---: |\n| 카드 | 0 |\n| 토큰 | 0 |' },
      ],
      warnings: [],
    }
    get().importRulebook(doc, { size, sheet, name })
  },

  importRulebook: (doc, opts) => {
    const built = buildRulebook(doc, opts)
    get().edit((p) => {
      p.components[built.component.id] = built.component
      if (!p.rulebooks) p.rulebooks = []
      p.rulebooks.push(built.rulebook)
    })
    set({
      mode: 'book',
      bookId: built.rulebook.id,
      pageId: built.rulebook.pages[0]?.id ?? null,
      instanceId: null,
      layerId: null,
    })
  },

  renameRulebook: (id, name) =>
    get().edit((p) => {
      const b = p.rulebooks?.find((x) => x.id === id)
      if (!b) return
      b.name = name
      const c = p.components[b.component]
      // 틀을 이 룰북만 쓰고 있으면 이름을 같이 맞춘다 (덱·보드와 같은 규칙)
      if (c && (p.rulebooks ?? []).filter((x) => x.component === b.component).length === 1) c.name = `${name} 쪽`
    }, `rn:${id}`),

  setRulebookOrder: (ids) =>
    get().edit((p) => {
      const bs = p.rulebooks ?? []
      const byId = new Map(bs.map((b) => [b.id, b]))
      const next = ids.map((id) => byId.get(id)).filter((b): b is Rulebook => !!b)
      if (next.length !== bs.length) return
      p.rulebooks = next
    }),

  setRulebookNote: (id, note) =>
    get().edit((p) => {
      const b = p.rulebooks?.find((x) => x.id === id)
      if (!b) return
      if (note.trim()) b.note = note
      else delete b.note
    }, `rnote:${id}`),

  duplicateRulebook: (id) => {
    const cid = uid('c')
    const bid = uid('book')
    get().edit((p) => {
      const src = p.rulebooks?.find((x) => x.id === id)
      const sc = src && p.components[src.component]
      if (!src || !sc) return
      p.components[cid] = structuredClone({ ...sc, id: cid, name: `${sc.name} 사본` })
      p.rulebooks!.push(
        structuredClone({
          ...src,
          id: bid,
          name: `${src.name} 사본`,
          component: cid,
          pages: src.pages.map((pg) => ({ ...pg, id: uid('page'), values: { ...pg.values } })),
        })
      )
    })
    const made = (get().project.rulebooks ?? []).find((b) => b.id === bid)
    if (made) set({ mode: 'book', bookId: bid, pageId: made.pages[0]?.id ?? null, layerId: null })
  },

  removeRulebook: (id) => {
    get().edit((p) => {
      const b = p.rulebooks?.find((x) => x.id === id)
      p.rulebooks = (p.rulebooks ?? []).filter((x) => x.id !== id)
      // 아무도 안 쓰는 틀은 같이 지운다 (덱·보드가 쓰고 있으면 남긴다)
      const used = (cid: string) =>
        p.decks.some((d) => d.component === cid || d.back === cid) ||
        (p.boards ?? []).some((x) => x.component === cid) ||
        (p.rulebooks ?? []).some((x) => x.component === cid)
      if (b && !used(b.component)) delete p.components[b.component]
    })
    if (get().bookId === id) {
      const next = get().project.rulebooks?.[0]
      set({ bookId: next?.id ?? '', pageId: next?.pages[0]?.id ?? null, layerId: null })
    }
  },

  patchRulebook: (patch) =>
    get().edit((p) => {
      const b = p.rulebooks?.find((x) => x.id === get().bookId)
      if (b) Object.assign(b, patch)
    }, `rb:${get().bookId}`),

  patchRulebookSheet: (patch) =>
    get().edit((p) => {
      const b = p.rulebooks?.find((x) => x.id === get().bookId)
      if (b) b.sheet = { ...b.sheet, ...patch }
    }, `rbsh:${get().bookId}`),

  addPage: () => {
    const id = uid('page')
    get().edit((p) => {
      const b = p.rulebooks?.find((x) => x.id === get().bookId)
      if (b) b.pages.push({ id, qty: 1, values: {} })
    })
    set({ pageId: id })
  },

  duplicatePage: (src) => {
    const id = uid('page')
    get().edit((p) => {
      const b = p.rulebooks?.find((x) => x.id === get().bookId)
      const i = b?.pages.findIndex((x) => x.id === src) ?? -1
      if (!b || i < 0) return
      b.pages.splice(i + 1, 0, { ...clone(b.pages[i]!), id })
    })
    set({ pageId: id })
  },

  removePage: (id) => {
    get().edit((p) => {
      const b = p.rulebooks?.find((x) => x.id === get().bookId)
      if (b) b.pages = b.pages.filter((x) => x.id !== id)
    })
    if (get().pageId === id) set({ pageId: get().rulebook()?.pages[0]?.id ?? null })
  },

  setPageOrder: (ids) =>
    get().edit((p) => {
      const b = p.rulebooks?.find((x) => x.id === get().bookId)
      if (!b) return
      const byId = new Map(b.pages.map((pg) => [pg.id, pg]))
      const next = ids.map((id) => byId.get(id)).filter((pg): pg is Instance => !!pg)
      if (next.length !== b.pages.length) return // 빠진 게 있으면 순서를 안 건드린다
      b.pages = next
    }),

  movePage: (id, dir) =>
    get().edit((p) => {
      const b = p.rulebooks?.find((x) => x.id === get().bookId)
      if (!b) return
      const i = b.pages.findIndex((x) => x.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= b.pages.length) return
      ;[b.pages[i], b.pages[j]] = [b.pages[j]!, b.pages[i]!]
    }),

  renumberPages: () =>
    get().edit((p) => {
      const b = p.rulebooks?.find((x) => x.id === get().bookId)
      if (!b) return
      // **쪽번호 레이어가 있을 때만** 손댄다. 이름이 다르면 사용자가 자기 방식으로
      // 만든 것이므로 마음대로 덮어쓰지 않는다.
      const c = p.components[b.component]
      if (!c?.layers.some((l) => l.id === FOLIO_LAYER && l.override === 'text')) return
      b.pages.forEach((pg, i) => {
        pg.values[FOLIO_LAYER] = i === 0 ? '' : String(i + 1)
      })
    }),

  patchSize: (patch) =>
    get().edit((p) => {
      const c = p.components[get().componentId()]!
      const next = { ...c.size, ...patch }
      // 원형은 지름 하나로 다룬다 — 폭만 바꿔도 높이가 따라온다
      if (next.shape === 'circle') {
        if (patch.w !== undefined) next.h = patch.w
        else if (patch.h !== undefined) next.w = patch.h
        else if (patch.shape === 'circle') next.h = next.w
      }
      c.size = next
    }, `sz:${get().componentId()}`),

  patchSheet: (patch) =>
    get().edit((p) => {
      const d = p.decks.find((x) => x.id === get().deckId)!
      d.sheet = { ...d.sheet, ...patch }
    }, `sh:${get().deckId}`),

  addInstance: () => {
    const id = uid('card')
    get().edit((p) => {
      p.decks.find((d) => d.id === get().deckId)!.instances.push({ id, qty: 1, values: {} })
    })
    set({ instanceId: id })
  },

  duplicateInstance: (src) => {
    const id = uid('card')
    get().edit((p) => {
      const d = p.decks.find((x) => x.id === get().deckId)!
      const i = d.instances.findIndex((x) => x.id === src)
      if (i < 0) return
      d.instances.splice(i + 1, 0, { ...clone(d.instances[i]!), id })
    })
    set({ instanceId: id })
  },

  removeInstance: (id) => {
    get().edit((p) => {
      const d = p.decks.find((x) => x.id === get().deckId)!
      d.instances = d.instances.filter((i) => i.id !== id)
    })
    set({ instanceId: get().deck().instances[0]?.id ?? null })
  },

  setValue: (instanceId, layerId, value) =>
    get().edit(
      (p) => {
        // 룰북에서는 쪽이 인스턴스 자리를 대신한다. 부르는 쪽(속성 패널)은
        // 둘을 구분하지 않아도 되도록 여기서 갈라준다.
        if (get().mode === 'book') {
          const b = p.rulebooks?.find((x) => x.id === get().bookId)
          const pg = b?.pages.find((x) => x.id === instanceId)
          if (pg) pg.values[layerId] = value
          return
        }
        const d = p.decks.find((x) => x.id === get().deckId)!
        const i = d.instances.find((x) => x.id === instanceId)
        if (i) i.values[layerId] = value
      },
      // 같은 칸을 계속 타이핑하는 동안은 한 단계로 합친다
      `value:${instanceId}:${layerId}`
    ),

  load: (p) =>
    set({
      project: p,
      // 불러오면 늘 덱부터 보여준다. 보드는 있는 프로젝트가 더 드물다.
      mode: 'deck',
      deckId: p.decks[0]?.id ?? '',
      boardId: p.boards?.[0]?.id ?? '',
      bookId: p.rulebooks?.[0]?.id ?? '',
      pageId: p.rulebooks?.[0]?.pages[0]?.id ?? null,
      instanceId: p.decks[0]?.instances[0]?.id ?? null,
      layerId: null,
      past: [],
      future: [],
      pending: null,
      lastKey: null,
      dirty: false,
    }),

  markSaved: () => set({ dirty: false }),
}))

/**
 * 프로젝트가 참조하는 모든 에셋 id.
 *
 * 이미지 오버라이드 값은 에셋 id 를 **그대로** 담는다 (접두사 없음).
 * 어떤 레이어가 이미지인지는 컴포넌트를 보면 알 수 있으므로 접두사가 필요 없고,
 * 저장할 때와 읽을 때 규칙이 갈리는 사고를 막는다.
 */
export function usedAssets(p: Project): Set<string> {
  const out = new Set<string>()
  const imageLayerIds = new Set<string>()
  for (const c of Object.values(p.components)) {
    for (const l of c.layers) {
      if (l.kind !== 'image') continue
      imageLayerIds.add(l.id)
      if (l.asset) out.add(l.asset)
    }
  }
  for (const d of p.decks) {
    for (const i of d.instances) {
      for (const [layerId, v] of Object.entries(i.values)) {
        if (v && imageLayerIds.has(layerId)) out.add(v)
      }
    }
  }
  // 룰북의 쪽도 같은 규칙 — 표지 그림이 여기 들어간다
  for (const b of p.rulebooks ?? []) {
    for (const pg of b.pages) {
      for (const [layerId, v] of Object.entries(pg.values)) {
        if (v && imageLayerIds.has(layerId)) out.add(v)
      }
    }
  }
  return out
}
