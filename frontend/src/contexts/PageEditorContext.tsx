import React, { createContext, useContext, useMemo, useState } from 'react'

/** What the page menu can ask of the mounted editor. */
export interface PageEditorApi {
  /** The document as Markdown. */
  exportMarkdown: () => string
  /** Replaces the document with the blocks of a Markdown text. */
  importMarkdown: (markdown: string) => Promise<void>
  /** Puts the cursor at the start of the first block. */
  focusStart: () => void
}

interface PageEditorContextValue {
  api: PageEditorApi | null
  setApi: (api: PageEditorApi | null) => void
}

const PageEditorContext = createContext<PageEditorContextValue | undefined>(undefined)

export function PageEditorProvider({ children }: { children: React.ReactNode }) {
  const [api, setApi] = useState<PageEditorApi | null>(null)
  const value = useMemo(() => ({ api, setApi }), [api])
  return <PageEditorContext.Provider value={value}>{children}</PageEditorContext.Provider>
}

export function usePageEditorApi() {
  const context = useContext(PageEditorContext)
  if (context === undefined) {
    throw new Error('usePageEditorApi must be used within a PageEditorProvider')
  }
  return context
}
