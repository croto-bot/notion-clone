/** Placeholder while a page loads. Matches a page with no cover and no icon. */
export function PageSkeleton() {
  return (
    <div aria-hidden="true" className="mx-auto w-full max-w-[900px] animate-pulse px-6 md:px-24">
      <div className="h-[72px]" />
      <div className="h-[32px]" />
      <div className="bg-hover-strong h-12 w-2/3 rounded-[4px]" />
      <div className="h-3" />
      <div className="mt-2 space-y-3">
        <div className="bg-hover h-5 w-full rounded-[3px]" />
        <div className="bg-hover h-5 w-5/6 rounded-[3px]" />
        <div className="bg-hover h-5 w-2/3 rounded-[3px]" />
      </div>
    </div>
  )
}
