/**
 * 예제 프로젝트 만들기 — «삼류 악녀는 싫어!» 구성품.
 *
 *   node example/build.mjs
 *
 * **정본은 `sub3/docs/rules/tokens.md` 다.** 장수·뒷면 색·덱 구성이 전부 거기 있고,
 * 카드 내용은 `omens.md`(재앙 10종) · `scenario.md`(운명 48장)에서 가져왔다.
 * (`sub3/nandeck/data/*.tsv` 는 옛 자료라 쓰지 않는다 — 문서와 어긋난다)
 *
 * 손으로 JSON 을 짜지 않고 스크립트로 두는 이유:
 *   - 능력 카드는 7종인데 100장이다. 수량은 `qty` 로 접힌다 — 표를 그대로 옮기면 된다
 *   - 문서가 개정되면 여기 배열만 고쳐 다시 돌린다
 *   - 무엇이 어디서 왔는지 배열 옆 주석에 남는다
 *
 * ⚠️ **토큰은 «지름만 한 네모» 로 만들었다.** 두근!·빌런·조우는 원래 동그란 토큰인데
 * 펀치가 없어 가위로 자를 수 있게 네모로 둔다. 지름을 그대로 한 변으로 썼으므로
 * 나중에 그 덱의 규격만 «토큰 · 원형» 으로 바꾸면 **크기 그대로 둥글어진다.**
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

// ── 규격 ───────────────────────────────────────────────────
const CARD = { w: 63, h: 88, shape: 'rect' }
/**
 * 토큰 — **원형 토큰의 지름만 한 정사각형**으로 뽑는다.
 *
 * 진짜 토큰(펀치로 둥글게)을 만들 재료가 아직 없어 가위로 자를 수 있게 네모로 둔다.
 * 지름을 그대로 한 변으로 쓰므로 **나중에 규격만 «토큰 · 원형 25» 로 바꾸면**
 * 크기가 그대로인 채 둥글어진다 — 레이어를 다시 잡을 필요가 없다.
 */
const TOKEN = { w: 25, h: 25, shape: 'rect' }
/** 이름이 들어가는 조우 토큰은 조금 크게 */
const TOKEN_L = { w: 35, h: 35, shape: 'rect' }
const A4 = { w: 210, h: 297, margin: 10, gap: 0, marks: 'crop', bleed: 3, bleedMode: 'none' }

// 뒷면 색은 tokens.md «카드 뒷면 색상 정리» 그대로
const BACK = {
  ability: '#C8A32E', // 노란색
  item: '#1F4E79', // 파란색
  fate: '#14121A', // 검은색 — 재앙과 디자인 **동일**해야 한다
  taste: '#C9738C', // 분홍색
  etc: '#4A423B',
}

let n = 0
const uid = (p) => `${p}-${(++n).toString(36).padStart(3, '0')}`

/**
 * 카드 한 종류의 틀.
 *
 * 이름·본문만 «카드마다 다르게» 로 열어둔다. 나머지(배경·띠·덱 이름)는 공통이라
 * 나중에 색 하나만 바꿔도 그 덱 전체가 따라온다 — 이게 이 도구의 요점이다.
 */
/**
 * 토큰 틀 — 작아서 카드 틀을 그대로 쓸 수 없다.
 * 색 바탕 + 테두리 + 가운데 이름. 그림 자리는 이름 뒤에 깐다.
 */
function tokenOf({ id, name, size, tint }) {
  const r = size.w / 2
  return {
    id,
    name,
    size: { ...size },
    background: '#FFFDFA',
    layers: [
      { id: 'bg', name: '바탕', kind: 'rect', x: 0, y: 0, w: size.w, h: size.h, fill: tint, radius: 2 },
      {
        id: 'art',
        name: '그림',
        kind: 'image',
        x: 1.5,
        y: 1.5,
        w: size.w - 3,
        h: size.h - 3,
        fit: 'cover',
        // 원형으로 바꿀 때를 대비해 둥글게 — 네모에서도 어색하지 않다
        radius: r - 1.5,
        override: 'image',
      },
      {
        id: 'ring',
        name: '테두리',
        kind: 'rect',
        x: 1.5,
        y: 1.5,
        w: size.w - 3,
        h: size.h - 3,
        stroke: '#FFFDFA',
        strokeWidth: 0.4,
        radius: r - 1.5,
      },
      {
        id: 'title',
        name: '이름',
        kind: 'text',
        x: 1,
        y: size.h / 2 - size.h * 0.16,
        w: size.w - 2,
        h: size.h * 0.32,
        size: size.w >= 35 ? 8 : 7,
        weight: 700,
        color: '#FFFDFA',
        align: 'center',
        valign: 'middle',
        shrink: true,
        shadow: '0 0.2mm 0.4mm rgba(0,0,0,.45)',
        override: 'text',
      },
    ],
  }
}

function frontOf({ id, name, size, tint, label, hasBody = true }) {
  const layers = [
    { id: 'bg', name: '바탕', kind: 'rect', x: 0, y: 0, w: size.w, h: size.h, fill: '#FFFDFA' },
    { id: 'band', name: '머리띠', kind: 'rect', x: 0, y: 0, w: size.w, h: size.h * 0.14, fill: tint },
    {
      id: 'art',
      name: '그림',
      kind: 'image',
      x: 0,
      y: size.h * 0.14,
      w: size.w,
      h: size.h * 0.42,
      fit: 'cover',
      override: 'image',
    },
    {
      id: 'title',
      name: '이름',
      kind: 'text',
      x: 3,
      y: size.h * 0.58,
      w: size.w - 6,
      h: size.h * 0.12,
      size: size.w > 50 ? 13 : 10,
      weight: 700,
      color: '#2E232A',
      align: 'center',
      valign: 'middle',
      shrink: true,
      override: 'text',
    },
  ]
  if (hasBody) {
    layers.push({
      id: 'body',
      name: '본문',
      kind: 'text',
      x: 4,
      y: size.h * 0.71,
      w: size.w - 8,
      h: size.h * 0.22,
      size: size.w > 50 ? 7.5 : 6,
      color: '#4A423B',
      align: 'center',
      valign: 'top',
      lineHeight: 1.45,
      override: 'text',
    })
  }
  layers.push({
    id: 'foot',
    name: '덱 이름',
    kind: 'text',
    x: 3,
    y: size.h - 6,
    w: size.w - 6,
    h: 4,
    text: label,
    size: 5.5,
    color: tint,
    align: 'center',
    letterSpacing: 0.6,
  })
  return { id, name, size: { ...size }, background: '#FFFDFA', layers }
}

/** 덱 공통 뒷면 — 색과 글자만 */
function backOf({ id, name, size, color, label, accent = '#FFFDFA' }) {
  return {
    id,
    name,
    size: { ...size },
    background: color,
    layers: [
      { id: 'bg', name: '바탕', kind: 'rect', x: 0, y: 0, w: size.w, h: size.h, fill: color },
      {
        id: 'ring',
        name: '테두리',
        kind: 'rect',
        x: 5,
        y: 5,
        w: size.w - 10,
        h: size.h - 10,
        stroke: accent,
        strokeWidth: 0.4,
        radius: 2,
      },
      {
        id: 'label',
        name: '이름',
        kind: 'text',
        x: 4,
        y: size.h / 2 - 6,
        w: size.w - 8,
        h: 12,
        text: label,
        size: 12,
        weight: 700,
        color: accent,
        align: 'center',
        valign: 'middle',
        letterSpacing: 1.2,
      },
    ],
  }
}

const components = {}
const decks = []

/**
 * 덱 하나를 만든다.
 * `cards` 는 `[이름, 본문, 수량]` — 수량을 안 적으면 1장.
 */
function deck({ key, name, size = CARD, tint, label, back, cards, hasBody = true, note, token }) {
  const front = token
    ? tokenOf({ id: `c-${key}`, name, size, tint })
    : frontOf({ id: `c-${key}`, name, size, tint, label, hasBody })
  if (token) hasBody = false
  components[front.id] = front
  let backId
  if (back) {
    const b = backOf({ id: `c-${key}-back`, name: `${name} 뒷면`, size, color: back.color, label: back.label, accent: back.accent })
    components[b.id] = b
    backId = b.id
  }
  decks.push({
    id: `d-${key}`,
    name,
    component: front.id,
    back: backId,
    sheet: { ...A4 },
    duplex: backId ? 'long' : false,
    expect: cards.reduce((s, c) => s + (c[2] ?? 1), 0),
    instances: cards.map(([title, body, qty]) => ({
      id: uid('card'),
      qty: qty ?? 1,
      values: hasBody ? { title, body: body ?? '' } : { title },
    })),
    ...(note ? { note } : {}),
  })
}

// ── 2. 능력 카드 — 7종 100장, 뒷면 노랑 (tokens.md §2) ──────
deck({
  key: 'ability',
  name: '능력 카드',
  tint: '#8C2F2F',
  label: '능력',
  back: { color: BACK.ability, label: '능력', accent: '#FFFDFA' },
  cards: [
    ['검', '모략 · 마수폭주 대응 · 투기장', 10],
    ['매력', '만남에서 1장 소모 · 약혼 유지', 40],
    ['마법', '모략 · 마수폭주 대응', 10],
    ['선혈', '선혈의 비에서 이득', 10],
    ['신성', '모략 · 정화', 10],
    ['독약', '모략', 10],
    ['어둠', '모략 · 은신', 10],
  ],
})

// ── 3.1 단서 — 18종 27장, 뒷면 파랑 (tokens.md §3.1) ────────
deck({
  key: 'clue',
  name: '물건 · 단서',
  tint: '#1F4E79',
  label: '과거의 단서',
  back: { color: BACK.item, label: '물건', accent: '#D8B976' },
  cards: [
    ['유모의 일기', '샬롯', 1],
    ['황가의 팬던트', '샬롯 · 마리 · 제노비아', 2],
    ['양녀증서', '샬롯', 1],
    ['폐태자의 편지', '샬롯 · 제노비아 · 이레네', 2],
    ['메모리 칩', '데이지', 1],
    ['벨의 단검', '데이지 · 마리\n‘내 사랑하는 여동생 데이지를 생각하며’', 2],
    ['교회 7094지부의 인명부', '데이지 · 마리', 2],
    ['약간 남은 망각포션', '마리', 1],
    ['교황칙서', '데이지 · 제노비아 · 이레네\n말살 — HAL, ZEN', 2],
    ['요마변환기', '미호', 1],
    ['호요족의 기록', '미호', 1],
    ['용사전기', '미호 · 바토리 · 그레이스', 2],
    ['백요잡서', '미호 · 바토리', 2],
    ['진조의 전승', '바토리', 1],
    ['영원의 관', '바토리 · 그레이스', 2],
    ['이교의 계약서', '제노비아 · 이레네 · 그레이스', 2],
    ['추기경서임서', '이레네', 1],
    ['인어의비늘', '그레이스', 1],
  ],
})

// ── 3.2 유물 — 세계 진실 5종 10장 + 엘릭서 3장 ──────────────
deck({
  key: 'relic',
  name: '물건 · 유물',
  tint: '#6B4E9E',
  label: '유물',
  back: { color: BACK.item, label: '물건', accent: '#D8B976' },
  cards: [
    ['고대 연구소의 출입증', '진실의 축 1 — 고대 SF 문명', 2],
    ['HAL의 코어 파편', '진실의 축 1 — 고대 SF 문명', 2],
    ['승천의 문 설계도', '진실의 축 2 — 용사와 승천', 2],
    ['승천자의 허물', '진실의 축 2 — 용사와 승천', 2],
    ['이전 빙의자의 수기', '진실의 축 3 — 소설 메타 진실', 2],
    ['엘릭서', '사용하면 빈사 에서 벗어난다', 3],
  ],
  note: '진실 물건 3장 이상 수집 → 승천의 문 토큰 (승천 엔딩)',
})

// ── 금화 60장 (tokens.md §12) ──────────────────────────────
deck({
  key: 'gold',
  name: '금화',
  tint: '#C8A32E',
  label: '금화',
  back: { color: BACK.item, label: '물건', accent: '#D8B976' },
  hasBody: false,
  cards: [['금화', null, 60]],
  note: '40장은 탐색 덱에 10장씩 · 20장은 세계은행연합',
})

// ── 5. 운명 카드 — 48장 (scenario.md) ──────────────────────
deck({
  key: 'fate',
  name: '운명 카드',
  tint: '#14121A',
  label: '운 명',
  back: { color: BACK.fate, label: '운명', accent: '#B3893A' },
  cards: [
    // 초반부 16
    ['어라... 이 힘은?', '초반부 · 주인공의 각성', 2],
    ['내가 일을 하나 맡기려고 하는데', '초반부 · 악녀의 의뢰', 4],
    ['충격! 대마법사 멀린의 사망', '초반부', 1],
    ['샬롯의 데뷔당트', '초반부', 1],
    ['깨어난 뱀파이어', '초반부', 1],
    ['제노비아, 쓸어버려', '초반부 · 루크레치아', 1],
    ['이레네, 이 자는 이교도야', '초반부 · 루크레치아', 1],
    ['데이지, 처리해', '초반부 · 메살리나', 1],
    ['제국의 해적소탕령', '초반부', 1],
    ['도망자 마리를 찾아', '초반부 · 로욱시나', 1],
    ['앗, 남주다!', '초반부', 1],
    ['주인공, 잔느 등장!', '초반부', 1],
    // 중반부 16
    ['메인 악녀 공세', '중반부 · 각 악녀 1장', 4],
    ['운명의 만남', '중반부 · 동일 카드', 4],
    ['운명의 강제력', '중반부 시나리오', 5],
    ['잔느 이벤트', '중반부', 3],
    // 후반부 16
    ['메인 빌런 토벌전', '후반부 · 각 지역 1장', 4],
    ['엔딩 경로 개봉', '후반부', 7],
    ['악령 관련', '후반부', 3],
    ['잔느의 설득', '후반부', 1],
    ['밝혀지는 과거', '후반부', 1],
  ],
  note: '초·중·후반부 각 16장 = 48장. 막당 2장씩 24막에 소진',
})

// ── 4. 재앙 카드 — 10종 10장 (omens.md) ────────────────────
deck({
  key: 'omen',
  name: '재앙 카드',
  tint: '#7D1F38',
  label: '재 앙',
  // 뒷면이 운명과 **완전히 동일**해야 한다 (섞였을 때 구분되면 안 된다)
  back: { color: BACK.fate, label: '운명', accent: '#B3893A' },
  cards: [
    ['선혈의 비', '국지 · 주사위로 정한 지역에 게임 끝까지 지속\n매 막 능력 카드 버림 (선혈 계열은 이득)'],
    ['칼날 비', '전역 · 동서남북·아카데미 강타\n모든 물건 또는 두근! 1 (검 각성자 이득)'],
    ['돌림병', '확산 · 막 종료마다 이웃으로 확산\n감염 지역 행동 1개 제한'],
    ['흑암', '전역 · 이동·탐색 불가 (마리오네트 면역)'],
    ['마력폭발', '전역 · 마법 카드/마도사 각성자가 폭발 피해'],
    ['초태 몰살', '전역 · 장자(첫째) 캐릭터 확정 사망'],
    ['마수폭주', '국지 · 매 막 검/마법 카드로 마수 상대\n없으면 두근! 1'],
    ['파리', '이동 · 파리 떼가 매 막 주사위로 이동 (게임 끝까지)\n놓인 지역 물건 피해'],
    ['소멸', '전역 · 무작위 지역 하나가 통째로 사라짐'],
    ['종막', '메타 · 즉시 후반부 운명 카드 더미로 진행'],
  ],
  note: '뒷면이 운명 카드와 동일해야 한다 — 섞였을 때 구분되면 안 됨',
})

// ── 6. 시나리오 카드 — 3장 ─────────────────────────────────
deck({
  key: 'scenario',
  name: '시나리오 카드',
  tint: '#3D5A9E',
  label: '서 막',
  back: { color: BACK.etc, label: '시나리오', accent: '#D8B976' },
  cards: [
    ['초반부', '구간 덱 맨 위에 올린다 · 막을 소모하지 않는다'],
    ['중반부', '구간 덱 맨 위에 올린다 · 막을 소모하지 않는다'],
    ['후반부', '서막 «메인 악녀 선언» 부착'],
  ],
})

// ── 7. 남주 성향 카드 — 20장, 뒷면 분홍 ────────────────────
deck({
  key: 'taste',
  name: '남주 성향 카드',
  tint: '#C9738C',
  label: '성 향',
  back: { color: BACK.taste, label: '성향', accent: '#FFFDFA' },
  cards: Array.from({ length: 20 }, (_, i) => [`성향 ${i + 1}`, '(문구 미정)']),
  note: '시작 시 각 남주에게 3장씩 뒷면으로 배치. 만남으로 오픈, 약혼에 사용',
})

// ── 1. 캐릭터 카드 ─────────────────────────────────────────
deck({
  key: 'pc',
  name: '캐릭터 · 플레이어',
  tint: '#2E232A',
  label: '플레이어',
  // 양면 — 뒷면이 «악령» 면이다 (두근! 을 모두 잃으면 뒤집는다)
  back: { color: '#14121A', label: '악 령', accent: '#7D1F38' },
  cards: [
    ['샬롯', '동부의 꽃 · 중부 시작'],
    ['데이지', '어둠의 시녀 · 동부 시작'],
    ['마리', '부두술사 · 서부 시작'],
    ['미호', '호요족 · 극동 시작'],
    ['바토리', '진조 · 북부 시작'],
    ['제노비아', '황가의 그림자 · 동부 시작'],
    ['이레네', '추기경 · 중부 시작'],
    ['그레이스', '대해적 · 남부 시작'],
  ],
  note: '양면 — 뒷면은 악령 버전',
})

deck({
  key: 'npc',
  name: '캐릭터 · NPC',
  tint: '#6B4E9E',
  label: 'NPC',
  cards: [
    ['잔느', '주인공'],
    ['알렉', '남주 · 서부'],
    ['가이우스', '남주 · 동부'],
    ['조반니', '남주 · 남부'],
    ['지크프리트', '남주 · 북부'],
    ['루크레치아', '메인 악녀'],
    ['메살리나', '메인 악녀'],
    ['로욱시나', '메인 악녀'],
    ['이제벨', '메인 악녀'],
  ],
})

// ── 8. 사기 카드 — 40장 ────────────────────────────────────
deck({
  key: 'skull',
  name: '사기 카드',
  tint: '#4A423B',
  label: '해 골',
  back: { color: '#14121A', label: '사기', accent: '#8A7D72' },
  hasBody: false,
  cards: [['사기', null, 40]],
  note: '악령 전용. 손패 상한 10장 × 최대 4인',
})

// ── 9·10·11. 토큰들 — 지금은 미니 카드로 뽑는다 ────────────
deck({
  key: 'heart',
  name: '두근! 토큰',
  size: TOKEN,
  token: true,
  tint: '#C9738C',
  cards: [['두근!', null, 30]],
  note: '지름 25mm 원형 토큰 자리 — 지금은 같은 크기의 네모로 뽑는다. 규격만 «토큰 · 원형 25» 로 바꾸면 그대로 둥글어진다. 시작 개수는 난이도로 결정 (플레이어 5~1 · NPC 0~2)',
})

deck({
  key: 'villain',
  name: '빌런 토큰',
  size: TOKEN,
  token: true,
  tint: '#7D1F38',
  cards: [['빌런', null, 30]],
  note: '지름 25mm 원형 토큰 자리 — 지금은 네모. 암살 성공마다 1개 (운명 저항력 겸 승점)',
})

deck({
  key: 'encounter',
  name: '조우 토큰',
  size: TOKEN_L,
  token: true,
  tint: '#3D5A9E',
  cards: [
    ['잔느', null, 4],
    ['루크레치아', null, 4],
    ['메살리나', null, 4],
    ['로욱시나', null, 4],
    ['이제벨', null, 4],
    ['알렉', null, 4],
    ['가이우스', null, 4],
    ['조반니', null, 4],
    ['지크프리트', null, 4],
  ],
  note: '9종 각 4개 = 36개. 이름이 들어가야 해서 지름 35mm — 지금은 네모',
})

// ── 15.2 요약 카드 — 양면, 인원수만큼 ──────────────────────
deck({
  key: 'aid',
  name: '요약 카드',
  tint: '#6D8F7A',
  label: '요 약',
  back: { color: '#6D8F7A', label: '행동 5~8', accent: '#FFFDFA' },
  cards: [
    [
      '행동 1~4',
      '이동 — 이웃 지역으로. 금화 1장\n탐색 — 주사위 1·2 능력 / 3~5 물건 / 6 물건 2\n수행 — 능력 2장 (아카데미 3장)\n각성 — 같은 능력 5장으로 고유 능력',
      4,
    ],
  ],
  note: '양면. 뒷면은 행동 5~8 (만남·모략·거래·약혼)',
})

// ── 키워드 — 규칙 용어는 본문과 구분돼야 한다 ──────────────
const keywords = [
  { id: 'kw-heart', word: '두근!', style: 'chip', bg: '#C9738C', color: '#FFFDFA' },
  { id: 'kw-villain', word: '빌런 포인트', style: 'chip', bg: '#7D1F38', color: '#FFFDFA' },
  { id: 'kw-spirit', word: '악령', style: 'chip', bg: '#14121A', color: '#B3893A' },
  { id: 'kw-dying', word: '빈사', style: 'outline', bg: '#7D1F38' },
  { id: 'kw-kill', word: '암살', style: 'bold', color: '#7D1F38' },
  { id: 'kw-awake', word: '각성', style: 'bold', color: '#3D5A9E' },
  { id: 'kw-engage', word: '약혼', style: 'bold', color: '#C9738C' },
]

/**
 * 인쇄 묶음 — 규격이 같은 덱을 한 종이에 이어 깐다.
 *
 * 덱마다 따로 뽑으면 마지막 장이 늘 반쯤 빈다. 규격이 같은 것끼리 묶으면
 * 그 빈 칸을 다음 덱이 채운다. **규격이 다르면 한 격자에 못 깔아 따로 묶는다.**
 *
 * ⚠️ 묶으면 한 장에 여러 덱이 섞여 나오므로 **자른 뒤 분류하는 수고**가 생긴다.
 * 시제품을 자주 뽑는 동안은 종이가 더 아깝고, 최종본은 덱별로 뽑는 게 편하다.
 */
const printGroups = [
  {
    id: 'pg-card',
    name: '카드 묶음 (63×88)',
    color: '#7D1F38',
    // 63×88 인 덱 전부. 위 `deck()` 호출 순서와 같게 둔다
    decks: [
      'd-ability',
      'd-clue',
      'd-relic',
      'd-gold',
      'd-fate',
      'd-omen',
      'd-scenario',
      'd-taste',
      'd-pc',
      'd-npc',
      'd-skull',
      'd-aid',
    ],
  },
  { id: 'pg-token', name: '토큰 묶음 (25×25)', color: '#1F4E79', decks: ['d-heart', 'd-villain'] },
]

const project = { handeck: 1, name: '삼류 악녀는 싫어!', components, decks, keywords, printGroups }

const out = join(here, 'project.json')
writeFileSync(out, JSON.stringify(project, null, 2))

const total = decks.reduce((s, d) => s + d.instances.reduce((t, i) => t + i.qty, 0), 0)
console.log(`${out}`)
console.log(`덱 ${decks.length}개 · 카드 종류 ${decks.reduce((s, d) => s + d.instances.length, 0)}종 · 총 ${total}장`)
for (const d of decks) {
  const q = d.instances.reduce((t, i) => t + i.qty, 0)
  console.log(`  ${d.name.padEnd(16)} ${String(d.instances.length).padStart(3)}종 ${String(q).padStart(4)}장`)
}
