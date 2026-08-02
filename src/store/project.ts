/**
 * 편집 상태.
 *
 * 실행취소는 «프로젝트 전체 스냅샷» 을 쌓는 방식이다.
 * 카드 프로젝트는 작아서(수백 KB) 이걸로 충분하고, 구현이 단순해 버그가 안 난다.
 * 이미지는 IndexedDB 에 따로 있어 스냅샷에 안 들어간다.
 */

import { create } from 'zustand'
import {
  type Component,
  type Deck,
  type FontRef,
  type Instance,
  type Keyword,
  type Layer,
  type PieceSize,
  type Project,
  type SheetSpec,
  A4,
  uid,
} from '../core/model.ts'
import { sampleProject } from '../core/sample.ts'

const LIMIT = 60

interface State {
  project: Project
  deckId: string
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
  /** 지금 편집 중인 틀의 id (앞/뒤에 따라 갈린다) */
  componentId: () => string
  component: () => Component
  instance: () => Instance | undefined
  layer: () => Layer | undefined

  selectDeck: (id: string) => void
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
  removeLayer: (id: string) => void
  moveLayer: (id: string, dir: -1 | 1) => void
  /** 목록에서 끌어 옮겼을 때. 배열 순서(뒤 -> 앞) 기준 id 목록을 그대로 받는다. */
  setLayerOrder: (idsBackToFront: string[]) => void

  /** 뒷면 틀을 붙이거나 뗀다. `'new'` 면 앞면과 같은 규격의 빈 틀을 만든다. */
  setBack: (idOrNew: string | 'new' | undefined) => void
  setDuplex: (v: false | 'long' | 'short') => void

  addDeck: (name: string, size: PieceSize) => void
  renameDeck: (id: string, name: string) => void
  /** 목록에서 위/아래로. 보이는 순서가 곧 작업 순서다. */
  moveDeck: (id: string, dir: -1 | 1) => void
  renameProject: (name: string) => void

  /** 이 프로젝트가 쓰는 글꼴 목록에 넣고 뺀다 (파일은 IndexedDB 에 따로 있다) */
  addFont: (ref: FontRef) => void
  removeFont: (id: string) => void
  /** 글꼴 이름이 바뀌면 그 글꼴을 쓰던 글자 레이어도 같이 따라가야 한다 */
  renameFontRef: (id: string, family: string) => void

  /** 카드 글에서 다르게 그릴 낱말 — 프로젝트 전체가 공유한다 */
  addKeyword: () => void
  patchKeyword: (id: string, patch: Partial<Keyword>) => void
  removeKeyword: (id: string) => void
  duplicateDeck: (id: string) => void
  removeDeck: (id: string) => void
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
  deckId: 'omens',
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
  componentId: () => {
    const s = get()
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
    return s.deck().instances.find((i) => i.id === s.instanceId)
  },
  layer: () => {
    const s = get()
    return s.component().layers.find((l) => l.id === s.layerId)
  },

  selectDeck: (id) => set({ deckId: id, side: 'front', instanceId: null, layerId: null }),
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

  removeLayer: (id) => {
    get().edit((p) => {
      const c = p.components[get().componentId()]!
      c.layers = c.layers.filter((l) => l.id !== id)
      // 이 레이어를 덮어쓰던 인스턴스 값도 같이 지운다
      for (const d of p.decks) for (const i of d.instances) delete i.values[id]
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

  moveDeck: (id, dir) =>
    get().edit((p) => {
      const i = p.decks.findIndex((d) => d.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= p.decks.length) return
      ;[p.decks[i], p.decks[j]] = [p.decks[j]!, p.decks[i]!]
    }),

  renameProject: (name) =>
    get().edit((p) => {
      p.name = name
    }, 'pname'),

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
      // 아무도 안 쓰는 틀은 같이 지운다 (앞면·뒷면 둘 다)
      const used = (cid: string) => p.decks.some((x) => x.component === cid || x.back === cid)
      if (d && !used(d.component)) delete p.components[d.component]
      if (d?.back && !used(d.back)) delete p.components[d.back]
    })
    if (get().deckId === id) {
      const next = get().project.decks[0]!
      set({ deckId: next.id, side: 'front', instanceId: next.instances[0]?.id ?? null, layerId: null })
    }
  },

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
      deckId: p.decks[0]?.id ?? '',
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
  return out
}
