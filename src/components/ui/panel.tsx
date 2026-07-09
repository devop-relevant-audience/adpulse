import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Panel — the canonical surface for content cards across the app.
 * Replaces the hand-rolled `bg-white rounded-xl border border-hairline` pattern.
 * Pass padding/layout via className; Panel only owns the surface (radius + border + bg).
 */
function Panel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="panel"
      className={cn("rounded-xl border border-hairline bg-white", className)}
      {...props}
    />
  )
}

export { Panel }
