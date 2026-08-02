import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages 는 `https://<사용자>.github.io/<레포>/` 아래에 놓인다.
  // 기본값(`/`)이면 자원을 도메인 뿌리에서 찾아 **빈 화면**이 나온다.
  // 레포 이름을 박는 대신 상대 경로로 둔다 — 이름이 바뀌어도, 하위 폴더에 올려도 그대로 된다.
  base: './',
  server: { port: 5180, open: false },
})
