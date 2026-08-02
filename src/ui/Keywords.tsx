/**
 * 키워드 설정.
 *
 * 규칙 용어(«돌진», «선제»)는 본문과 구분돼야 하는데, 카드마다 손으로 굵게 만들면
 * 100장을 고쳐야 하고 빠뜨리기도 한다. 여기 한 번 적어두면 **모든 카드에서**
 * 같은 모양으로 나온다. 카드 글은 그냥 «돌진» 이라고만 쓰면 된다.
 */

import { useStore } from '../store/project.ts'
import { styleText } from '../core/render.tsx'
import type { Keyword } from '../core/model.ts'

const STYLES: { v: Keyword['style']; label: string }[] = [
  { v: 'chip', label: '칩' },
  { v: 'bold', label: '진하게' },
  { v: 'color', label: '색만' },
]

/** 미리보기 문장 — 실제 렌더 코드로 그린다. 설명보다 이게 빠르다. */
const SAMPLE = (word: string) => `이 카드를 낼 때 ${word || '…'} 효과를 받는다.`

export function Keywords({ onClose }: { onClose: () => void }) {
  const s = useStore()
  const list = s.project.keywords ?? []

  return (
    <div className="modal" onMouseDown={onClose}>
      <div className="sheetbox" onMouseDown={(e) => e.stopPropagation()}>
        <h3>키워드</h3>
        <p className="hint nopad">
          여기 적은 낱말이 카드 글에 나오면 <b>모든 카드에서 자동으로</b> 이 모양으로 그려집니다.
          카드에는 그냥 낱말만 쓰면 됩니다. 덱을 가리지 않고 프로젝트 전체에 적용됩니다.
        </p>

        {list.length === 0 ? (
          <p className="hint sm">아직 없습니다. 아래에서 추가하세요.</p>
        ) : (
          <div className="kwlist">
            {list.map((k) => (
              <div key={k.id} className="kwitem">
                <input
                  className="kword"
                  value={k.word}
                  placeholder="낱말"
                  onChange={(e) => s.patchKeyword(k.id, { word: e.target.value })}
                />
                <select
                  value={k.style}
                  onChange={(e) => s.patchKeyword(k.id, { style: e.target.value as Keyword['style'] })}
                >
                  {STYLES.map((x) => (
                    <option key={x.v} value={x.v}>
                      {x.label}
                    </option>
                  ))}
                </select>
                {/* 칩은 배경색이 주인공이고, 나머지는 글자색이 주인공이다 */}
                {k.style === 'chip' && (
                  <input
                    type="color"
                    title="칩 배경색"
                    value={k.bg ?? '#2E232A'}
                    onChange={(e) => s.patchKeyword(k.id, { bg: e.target.value })}
                  />
                )}
                <input
                  type="color"
                  title={k.style === 'chip' ? '칩 글자색' : '글자색'}
                  value={k.color ?? (k.style === 'chip' ? '#FFFDFA' : '#7D1F38')}
                  onChange={(e) => s.patchKeyword(k.id, { color: e.target.value })}
                />
                <span className="kwsample">{styleText(SAMPLE(k.word), [k])}</span>
                <button className="del" title="지우기" onClick={() => s.removeKeyword(k.id)}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="rowbtn">
          <button onClick={s.addKeyword}>+ 키워드</button>
          <button className="go" onClick={onClose}>
            닫기
          </button>
        </div>

        <p className="hint sm nopad">
          긴 낱말이 먼저 걸립니다 — «돌진» 과 «연속 돌진» 을 둘 다 넣어도 «연속 돌진» 이 통째로 잡힙니다.
        </p>
      </div>
    </div>
  )
}
