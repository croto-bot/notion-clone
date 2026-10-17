import { en } from '@blocknote/core/locales'

/** Notion's wording for the empty-block hints. */
export const editorDictionary = {
  ...en,
  placeholders: {
    ...en.placeholders,
    default: "Type '/' for commands",
    heading: 'Heading',
    toggleListItem: 'Toggle',
    bulletListItem: 'List',
    numberedListItem: 'List',
    checkListItem: 'To-do',
  },
}

/** Decodes the base64 Yjs update the backend sends as `state`. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
