/**
 * 처음 열었을 때 보이는 예제.
 *
 * 빈 화면으로 시작하면 무엇을 할 수 있는 도구인지 알 수 없다.
 * «전면 일러스트 + 그늘 + 겹친 글자» 라는 기본 구성을 예제로 보여준다.
 */

import { A4, type Project } from './model.ts'

export function sampleProject(): Project {
  return {
    handeck: 1,
    name: '새 프로젝트',
    components: {
      omen: {
        id: 'omen',
        name: '재앙 카드',
        size: { w: 63, h: 88, shape: 'rect' },
        background: '#FFFDFA',
        layers: [
          {
            id: 'art',
            name: '일러스트',
            kind: 'image',
            x: 0,
            y: 0,
            w: 63,
            h: 53,
            fit: 'cover',
            position: 'center 35%',
            override: 'image', // 카드마다 다른 그림
          },
          {
            id: 'veil',
            name: '그늘',
            kind: 'gradient',
            x: 0,
            y: 0,
            w: 63,
            h: 55,
            direction: 'to bottom',
            stops: [
              'rgba(20,18,26,.72) 0%',
              'rgba(20,18,26,.12) 32%',
              'rgba(255,253,250,0) 58%',
              'rgba(255,253,250,.94) 88%',
              '#FFFDFA 100%',
            ],
          },
          {
            id: 'kicker',
            name: '머리말',
            kind: 'text',
            x: 3,
            y: 2,
            w: 30,
            h: 6,
            text: '재앙',
            size: 7.5,
            weight: 700,
            color: '#D8B976',
            align: 'left',
            letterSpacing: 1,
          },
          {
            id: 'no',
            name: '번호',
            kind: 'text',
            x: 43,
            y: 1,
            w: 17,
            h: 8,
            size: 15,
            weight: 400,
            color: '#D8B976',
            align: 'right',
            font: 'var(--hd-serif)',
            override: 'text',
          },
          {
            id: 'title',
            name: '제목',
            kind: 'text',
            x: 2,
            y: 35,
            w: 59,
            h: 10,
            size: 17,
            weight: 700,
            color: '#571026',
            align: 'center',
            font: 'var(--hd-serif)',
            override: 'text',
          },
          {
            id: 'body',
            name: '본문',
            kind: 'text',
            x: 3,
            y: 49,
            w: 57,
            h: 24,
            size: 7.5,
            color: '#2E232A',
            align: 'left',
            valign: 'top',
            lineHeight: 1.45,
            shrink: true,
            override: 'text',
          },
          {
            id: 'flavor',
            name: '플레이버',
            kind: 'text',
            x: 3,
            y: 77,
            w: 57,
            h: 8,
            size: 7,
            color: '#7D1F38',
            align: 'center',
            italic: true,
            font: 'var(--hd-serif)',
            override: 'text',
          },
        ],
      },
    },
    decks: [
      {
        id: 'omens',
        name: '재앙',
        component: 'omen',
        sheet: A4,
        duplex: false,
        expect: 3,
        instances: [
          {
            id: 'i1',
            qty: 1,
            values: {
              no: '1',
              title: '선혈의 비',
              body: '주사위를 굴려 나온 지역에 선혈의 비 토큰을 놓는다.\n매 막 종료 시 그 지역의 플레이어는 능력 카드 1장을 버린다.',
              flavor: '피비린내가 나는군…',
            },
          },
          {
            id: 'i2',
            qty: 1,
            values: {
              no: '2',
              title: '칼날 비',
              body: '동·서·남·북과 아카데미에 칼날이 쏟아진다.\n해당 지역의 플레이어는 모든 물건 카드를 잃거나 두근! 1을 잃는다.',
              flavor: '수천, 아니 수만 개의 검이 떨어진다.',
            },
          },
          {
            id: 'i3',
            qty: 1,
            values: {
              no: '3',
              title: '돌림병',
              body: '역병이 한 지역에서 시작되어 매 막 종료 시 이웃 지역으로 퍼진다.\n감염 지역의 플레이어는 자기 턴에 행동을 1개만 할 수 있다.',
              flavor: '콜록콜록… 이거 낫는 거 맞죠?',
            },
          },
        ],
      },
    ],
  }
}
