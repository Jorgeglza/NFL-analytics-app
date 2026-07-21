import { useEffect } from "react";

// Pass undefined to skip setting the title this render (e.g. a parent tab
// container deferring to a child that shows a more specific title while its
// tab is active — avoids a parent/child effect-ordering race).
export function usePageTitle(title: string | undefined) {
  useEffect(() => {
    if (title != null) document.title = title;
  }, [title]);
}
