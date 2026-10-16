/** Placeholder while a page loads: a title bar and a few lines. */
export function PageSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto w-full max-w-[900px] animate-pulse px-6 pt-[120px] md:px-24"
    >
      <div className="bg-hover-strong h-10 w-2/3 rounded-[4px]" />
      <div className="mt-8 space-y-3">
        <div className="bg-hover h-4 w-full rounded-[3px]" />
        <div className="bg-hover h-4 w-5/6 rounded-[3px]" />
        <div className="bg-hover h-4 w-2/3 rounded-[3px]" />
      </div>
    </div>
  )
}
