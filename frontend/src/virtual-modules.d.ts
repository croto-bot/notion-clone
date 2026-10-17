// Modules that vite.config.ts provides.
declare module 'virtual:emoji-data' {
  import type { EmojiMartData } from '@emoji-mart/data'
  const data: EmojiMartData
  export default data
}
