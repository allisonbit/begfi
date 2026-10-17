/**
 * The one loading state, for every route that does not define its own.
 *
 * WHY SKELETONS AND NOT A SPINNER. A spinner says "something is happening"; a
 * skeleton says what is about to be there, so the page does not jump when the
 * data lands. These blocks deliberately have no labels: the moment a skeleton
 * starts describing content it can describe the wrong thing, and a placeholder
 * that lies is worse than an honest grey box.
 *
 * `aria-busy` and one live region give a screen reader the same information the
 * shimmer gives everyone else, without narrating four grey rectangles.
 */
export default function Loading() {
  return (
    <div className="safe-x mx-auto max-w-[1000px] py-12" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading this page</span>
      <div className="h-3 w-24 animate-pulse rounded-full bg-beg-line" />
      <div className="mt-4 h-10 w-[min(420px,70%)] animate-pulse rounded-2xl bg-beg-line" />
      <div className="mt-3 h-4 w-[min(560px,90%)] animate-pulse rounded-full bg-beg-line" />
      <div className="mt-8 grid gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card-sm flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="size-8 animate-pulse rounded-full bg-beg-line" />
              <div className="h-4 w-32 animate-pulse rounded-full bg-beg-line" />
            </div>
            <div className="h-4 w-24 animate-pulse rounded-full bg-beg-line" />
          </div>
        ))}
      </div>
    </div>
  );
}
