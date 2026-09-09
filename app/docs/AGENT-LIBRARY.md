# Reuse Media Lab creations in the builder

Each builder turn captures completed device/server library metadata. The model
receives titles, kind, creation date, source category, original extension, and
an opaque reference. It does not receive bearer tickets, source file URIs, server
addresses, or media bytes. Descriptive titles are explicitly untrusted data.

The snapshot keeps the five newest entries per kind and source, so many recent
local images cannot hide the latest server video. Remote discovery has a short
three-second deadline; an unavailable server is reported in context rather than
preventing ordinary coding. Large gallery payloads are not embedded in prompts.

To reuse an offered creation, the assistant emits an empty, closed fence:

````text
```asset id=REFERENCE_FROM_CURRENT_SNAPSHOT file=assets/win.webm
```
````

The assistant also writes ordinary file blocks using that relative path, such as
a game win handler which sets a video's source and plays it. A request to reuse
existing media is not a request to generate new media.

Before import, the app checks all references, original extensions, a four-import
limit, current project paths, duplicate targets, and collisions with generated
file/media outputs. It rejects stale references rather than reinterpreting them
against a newer snapshot. References are unique to the turn.

Actual bytes are copied into project storage before app code is written. If an
asset download fails, the code update is stopped; any already imported assets
remain recorded in the assistant message's written-file list. The generated
project never needs the library's ticket or server address to display its copy.

Known limits: asset discovery is recent and bounded, not a semantic search of an
unlimited library. Model selection quality still needs live-provider evaluation.
Cross-process writes are not transactional, and large imports still need streaming
storage. The static browser preview is not a general module bundler or a verified
3D engine. Missing/older assets can be selected manually through Library.
