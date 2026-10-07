# Viewer Runtime reference

Read this only when the user asks for a reader-facing capability. Ordinary generation does not require implementing or re-documenting these features; they are already in the generated HTML.

## Exploration

- Diagram Guide lists current actions and shortcuts.
- Reading Depth starts at READ at the default 100% scale, reveals FULL detail at 175%, and falls back to MAP only below 100%. Focus, route, and semantic interactions reveal their exact facts at any scale.
- Semantic Lens summarizes selected node/relationship kinds without changing authored geometry.
- Intent Trace previews a fine-pointer or keyboard target before committed focus.
- Node Finder searches labels and stable IDs.
- Semantic Passport opens on focus, shows authored upstream/downstream facts, supports a copyable deep link, has an explicit close action, closes on true outside activation and Escape, and never enters canonical export.
- Semantic Radar mirrors the visible viewport and authored graph without becoming a second source of truth.
- Direct Relationship Pin makes a unique compiled relationship operable while preserving the authored line and stable relationship identity. It must fail closed on conflicting source/target/label/ID metadata.
- Route Probe resolves exactly two endpoints over authored directed relationships. It never infers a route from geometry.

Authored subarchitectures expand below the main graph in the same page. Opening internals scrolls to that section and focuses its return control. Back, Close, and Escape restore the previous page position and parent focus. The parent keeps its reading layout while the child is open. Child SVGs retain their natural aspect ratio. On desktop, the child fits the available width and viewport height while preserving primary labels of at least 10 CSS pixels. Graphs that cannot fit at that reading size use page scrolling. A narrow stage scrolls horizontally, and component details do not shrink the graph. Window resizing and theme or preset changes recalculate the child size without changing its authored geometry or export dimensions.

## Motion and presentation

`meta.animation: "trace"` enables a finite reader-controlled Live/Still trace. Static is the default. Still, reduced motion, page hiding, print, and canonical export preserve complete static meaning. Presentation Stage changes viewer chrome and framing, never authored geometry. This is not a mobile product feature; narrow layouts get containment only.

## Canonical exports

The export menu can copy/download full-diagram PNG, download JPEG/WebP, download a dual-theme SVG, and record a trace-enabled WebM. Viewer state—Guide, Lens, finder, focus, route, camera, radar, presentation, motion ownership, and temporary overlays—must be removed from canonical export.

### Route Share Card

After a real directed Route Probe resolves, the reader may use **Export → Route Share Card**. It reuses the exact ordered route snapshot and the shared Share Card seam: `format=share-card`, `variant=route`. The isolated clone may use only static `data-share-route-*` decoration. It is download-only, fails closed for stale/unreachable/conflicting routes, and never becomes the canonical artifact.

### Reach Share Card

After a non-empty authored reachability query, the reader may use **Export → Reach Share Card**. It consumes the already resolved upstream/downstream node and edge set without rerunning traversal: `format=share-card`, `variant=reach`. The isolated clone may use only static `data-share-reach-*` decoration. It is download-only. Call it authored reachability—not impact, blast radius, breakage, or runtime causality.

## Truth boundary

Viewer exports are communication assets. They do not replace the checked HTML, the deterministic delivery receipt, or a real visual review. Do not add a hosted service, storage surface, dependency, schema branch, or mobile product surface for these viewer-only capabilities.

When authored subarchitectures exist, the menu lists **Main architecture** and each child by name. The main architecture remains the default. A child can be exported without opening it or selecting its parent. The child target reuses the canonical cleanup and PNG/JPEG/WebP/SVG/clipboard/Share Card paths, using a fresh clone of its verified template. The parent graph, drawer, Semantic Passport, and temporary local focus or Intent Trace state never enter the result. Export selection is independent of the open child and stays selected when a view closes. Route/Reach Share Cards and trace WebM remain parent-only because their snapshots belong to the canonical parent runtime. Invalidating the selected template fails closed rather than exporting another graph. Diagrams without children retain the original menu and export behavior.
