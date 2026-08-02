import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Canvas } from './ui/Canvas.tsx'
import { Cards } from './ui/Cards.tsx'
import { Inspector } from './ui/Inspector.tsx'
import { PrintView } from './ui/Print.tsx'
import { Calibrate } from './ui/Calibrate.tsx'
/* 내보내기는 `react-dom/server` 를 끌고 와서 무겁다 (+80KB).
   창을 열 때 받게 떼어둔다 — 안 쓰는 사람이 그 값을 치를 이유가 없다. */
const Export = lazy(() => import('./ui/Export.tsx').then((m) => ({ default: m.Export })))
import { screenScale, screenVersion, subscribeScreen } from './store/screen.ts'
import { useStore, usedAssets } from './store/project.ts'
import { assetsVersion, subscribeAssets, warmUrls } from './store/assets.ts'
import { fontsVersion, loadFonts, subscribeFonts } from './store/fonts.ts'
import { downloadProject, loadLocal, migrate, saveLocal } from './store/persist.ts'
import { totalPieces } from './core/model.ts'
import { sampleProject } from './core/sample.ts'

export default function App() {
  const s = useStore()
  const [zoom, setZoom] = useState(2)
  const [printing, setPrinting] = useState(false)
  const [calibrating, setCalibrating] = useState(false)
  const [exporting, setExporting] = useState(false)
  // 켜고 끈 상태는 기억한다 — 매번 다시 켜야 하면 스위치가 없느니만 못하다
  const [rulers, setRulers] = useState(() => {
    try {
      return localStorage.getItem('handeck:rulers') !== '0'
    } catch {
      return true
    }
  })
  const fileIn = useRef<HTMLInputElement>(null)

  // 에셋 URL 이 채워지면 다시 그린다 (업로드했는데 반영이 안 되는 걸 막는다)
  useSyncExternalStore(subscribeAssets, assetsVersion)
  // 글꼴도 같은 이유. 늦게 붙어도 화면이 다시 그려져야 한다.
  useSyncExternalStore(subscribeFonts, fontsVersion)
  // 화면 보정이 바뀌면 머리말의 표시도 따라가야 한다
  useSyncExternalStore(subscribeScreen, screenVersion)

  // 지난번에 넣어둔 글꼴을 브라우저에 다시 단다
  useEffect(() => {
    void loadFonts()
  }, [])

  // 새로고침해도 작업이 남게 한다. 서버가 없으니 이게 안전망이다.
  useEffect(() => {
    const saved = loadLocal()
    if (saved) s.load(saved)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const t = setTimeout(() => saveLocal(s.project), 400)
    return () => clearTimeout(t)
  }, [s.project])

  // 프로젝트가 쓰는 이미지를 IndexedDB 에서 꺼내 화면용 URL 을 만든다
  useEffect(() => {
    void warmUrls(usedAssets(s.project))
  }, [s.project])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
      }
      if (e.key === 'Delete' && s.layerId) s.removeLayer(s.layerId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s])

  const deck = s.deck()
  const c = s.component()

  const openFile = async (f: File) => {
    try {
      const p = migrate(JSON.parse(await f.text()))
      if (p?.handeck !== 1) throw new Error('handeck 프로젝트 파일이 아닙니다')
      s.load(p)
      await warmUrls(usedAssets(p))
    } catch (err) {
      alert(`열지 못했습니다: ${err instanceof Error ? err.message : err}`)
    }
  }

  return (
    <div className="app">
      <header>
        <span className="brand">handeck</span>
        {/* 프로젝트 이름은 그대로 저장 파일 이름이 된다.
            «새 프로젝트» 가 여럿 쌓이면 어느 게 어느 건지 알 수 없다. */}
        <input
          className="file"
          value={s.project.name}
          placeholder="프로젝트 이름"
          title="프로젝트 이름 — 저장할 때 파일 이름이 됩니다"
          size={Math.max(8, s.project.name.length + 1)}
          onChange={(e) => s.renameProject(e.target.value)}
        />
        {s.dirty && <span className="dirty" title="저장하지 않은 변경">*</span>}
        <span className="sp" />
        <div className="zoom">
          <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>−</button>
          {/* 100% 가 실물 크기가 아닐 수 있다 — 브라우저는 이 화면이 몇 인치인지 모른다.
              눌러서 한 번 맞춰두면 그 다음부터 «100% = 자로 잰 63×88mm» 가 된다. */}
          <button
            className="cal"
            title="화면 실물 크기 맞추기 — 100% 가 자로 잰 크기와 다르면 여기서 보정합니다"
            onClick={() => setCalibrating(true)}
          >
            {Math.round(zoom * 100)}%
            {screenScale() !== 1 && <em>·{Math.round(screenScale() * 1000) / 10}</em>}
          </button>
          <button onClick={() => setZoom((z) => Math.min(6, z + 0.25))}>+</button>
        </div>
        <label className="chk" title="판 옆에 mm 눈금자를 붙입니다. 0 은 카드의 왼쪽 위 모서리입니다">
          <input
            type="checkbox"
            checked={rulers}
            onChange={(e) => {
              setRulers(e.target.checked)
              try {
                localStorage.setItem('handeck:rulers', e.target.checked ? '1' : '0')
              } catch {
                // 저장 못 해도 이번 세션에서는 동작한다
              }
            }}
          />
          눈금자
        </label>
        <button onClick={s.undo} disabled={!s.past.length} title="Ctrl+Z">
          되돌리기
        </button>
        <button onClick={s.redo} disabled={!s.future.length} title="Ctrl+Shift+Z">
          다시
        </button>
        <button onClick={() => fileIn.current?.click()}>열기</button>
        <button onClick={() => downloadProject(s.project)}>저장</button>
        <button
          onClick={() => {
            if (confirm('예제로 되돌립니다. 지금 작업은 사라집니다.')) s.load(sampleProject())
          }}
        >
          초기화
        </button>
        <button onClick={() => setExporting(true)} title="지금 보는 카드나 덱 전체를 PNG 그림으로 받습니다 — 보여주고 의견 받을 때">
          PNG
        </button>
        <button className="go" onClick={() => setPrinting(true)} title="종이에 깔아 보여주고, 인쇄 대화상자에서 PDF 로 저장합니다">
          인쇄 / PDF
        </button>
        <input
          ref={fileIn}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void openFile(f)
          }}
        />
      </header>

      <Cards />
      <Canvas zoom={zoom} rulers={rulers} />
      <Inspector />

      <footer>
        <span>
          {deck.name} · <b>{totalPieces(deck)}장</b>
        </span>
        <span>
          {c.size.w} × {c.size.h} mm
        </span>
        <span>레이어 {c.layers.length}</span>
        <span className="sp" />
        <span>자동 저장됨 (이 브라우저)</span>
      </footer>

      {printing && (
        <PrintView project={s.project} deckId={s.deckId} onClose={() => setPrinting(false)} />
      )}
      {calibrating && <Calibrate onClose={() => setCalibrating(false)} />}
      {exporting && (
        <Suspense fallback={null}>
          <Export onClose={() => setExporting(false)} />
        </Suspense>
      )}
    </div>
  )
}
